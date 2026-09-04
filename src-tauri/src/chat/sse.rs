//! Server-sent events framing for streaming LLM responses.
//!
//! Both provider shapes stream SSE, so the framing is shared and the per-shape
//! code only has to interpret the JSON inside each `data:` payload. Kept
//! separate from the HTTP call so it can be tested without a network.

/// One SSE event: its `event:` name (absent for OpenAI, present for Anthropic)
/// and the concatenated `data:` payload.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SseEvent {
    pub name: Option<String>,
    pub data: String,
}

impl SseEvent {
    /// OpenAI terminates its stream with a literal `data: [DONE]` sentinel,
    /// which is not JSON and must not be parsed as a delta.
    pub fn is_done_sentinel(&self) -> bool {
        self.data.trim() == "[DONE]"
    }
}

/// Accumulates bytes into complete SSE events.
///
/// A chunk boundary can fall anywhere — mid-line, mid-JSON, between the `data:`
/// lines of one event — so the parser holds a buffer across chunks and only
/// yields events terminated by a blank line.
#[derive(Debug, Default)]
pub struct SseParser {
    buffer: String,
}

impl SseParser {
    pub fn new() -> Self {
        Self::default()
    }

    /// Feeds a chunk and returns every event completed by it.
    pub fn push(&mut self, chunk: &str) -> Vec<SseEvent> {
        self.buffer.push_str(chunk);
        let mut events = Vec::new();

        // Events are separated by a blank line. \r\n is tolerated because some
        // proxies rewrite line endings.
        while let Some((raw, rest)) = split_at_event_boundary(&self.buffer) {
            let raw = raw.to_string();
            self.buffer = rest.to_string();
            if let Some(event) = parse_event(&raw) {
                events.push(event);
            }
        }

        events
    }

    /// Any trailing event the stream ended without a blank line after. Servers
    /// usually terminate cleanly, but a truncated final frame should not silently
    /// drop the last delta.
    pub fn finish(&mut self) -> Option<SseEvent> {
        let raw = std::mem::take(&mut self.buffer);
        parse_event(&raw)
    }
}

/// Splits off the first complete event, returning it and the remaining buffer.
fn split_at_event_boundary(buffer: &str) -> Option<(&str, &str)> {
    let lf = buffer.find("\n\n").map(|index| (index, index + 2));
    let crlf = buffer.find("\r\n\r\n").map(|index| (index, index + 4));

    // Whichever terminator comes first wins; a \r\n\r\n contains no \n\n, so
    // the two cannot overlap ambiguously.
    let (end, next) = match (lf, crlf) {
        (Some(lf), Some(crlf)) if lf.0 <= crlf.0 => lf,
        (Some(_), Some(crlf)) => crlf,
        (Some(lf), None) => lf,
        (None, Some(crlf)) => crlf,
        (None, None) => return None,
    };

    Some((&buffer[..end], &buffer[next..]))
}

/// Parses one event block. Comment lines (`:` prefixed, used as keep-alives) and
/// unknown fields are ignored; multiple `data:` lines join with newlines per the
/// SSE spec.
fn parse_event(raw: &str) -> Option<SseEvent> {
    let mut name = None;
    let mut data_lines: Vec<&str> = Vec::new();

    for line in raw.lines() {
        let line = line.trim_end_matches('\r');
        if line.is_empty() || line.starts_with(':') {
            continue;
        }
        let Some((field, value)) = line.split_once(':') else {
            continue;
        };
        // A single leading space after the colon is part of the framing.
        let value = value.strip_prefix(' ').unwrap_or(value);
        match field {
            "event" => name = Some(value.to_string()),
            "data" => data_lines.push(value),
            _ => {}
        }
    }

    if data_lines.is_empty() {
        return None;
    }

    Some(SseEvent {
        name,
        data: data_lines.join("\n"),
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn event(name: Option<&str>, data: &str) -> SseEvent {
        SseEvent {
            name: name.map(ToString::to_string),
            data: data.to_string(),
        }
    }

    #[test]
    fn parses_openai_style_data_only_events() {
        let mut parser = SseParser::new();
        let events = parser.push("data: {\"a\":1}\n\ndata: {\"a\":2}\n\n");
        assert_eq!(
            events,
            vec![event(None, "{\"a\":1}"), event(None, "{\"a\":2}")]
        );
    }

    #[test]
    fn parses_anthropic_style_named_events() {
        let mut parser = SseParser::new();
        let events = parser.push("event: content_block_delta\ndata: {\"x\":1}\n\n");
        assert_eq!(events, vec![event(Some("content_block_delta"), "{\"x\":1}")]);
    }

    #[test]
    fn reassembles_events_split_across_chunks() {
        let mut parser = SseParser::new();
        // A chunk boundary mid-JSON must not produce a partial event.
        assert!(parser.push("data: {\"text\":\"hel").is_empty());
        assert!(parser.push("lo\"}").is_empty());
        let events = parser.push("\n\n");
        assert_eq!(events, vec![event(None, "{\"text\":\"hello\"}")]);
    }

    #[test]
    fn joins_multiple_data_lines() {
        let mut parser = SseParser::new();
        let events = parser.push("data: line one\ndata: line two\n\n");
        assert_eq!(events, vec![event(None, "line one\nline two")]);
    }

    #[test]
    fn ignores_keep_alive_comments_and_unknown_fields() {
        let mut parser = SseParser::new();
        let events = parser.push(": ping\n\nid: 7\nretry: 100\ndata: {}\n\n");
        assert_eq!(events, vec![event(None, "{}")]);
    }

    #[test]
    fn tolerates_crlf_line_endings() {
        let mut parser = SseParser::new();
        let events = parser.push("event: delta\r\ndata: {\"a\":1}\r\n\r\n");
        assert_eq!(events, vec![event(Some("delta"), "{\"a\":1}")]);
    }

    #[test]
    fn recognises_the_done_sentinel() {
        let mut parser = SseParser::new();
        let events = parser.push("data: [DONE]\n\n");
        assert_eq!(events.len(), 1);
        assert!(events[0].is_done_sentinel());
        assert!(!event(None, "{\"a\":1}").is_done_sentinel());
    }

    #[test]
    fn returns_a_trailing_event_the_stream_never_terminated() {
        let mut parser = SseParser::new();
        assert!(parser.push("data: {\"a\":1}").is_empty());
        assert_eq!(parser.finish(), Some(event(None, "{\"a\":1}")));
        // And nothing the second time.
        assert_eq!(parser.finish(), None);
    }

    #[test]
    fn finish_is_empty_after_a_clean_stream() {
        let mut parser = SseParser::new();
        parser.push("data: {}\n\n");
        assert_eq!(parser.finish(), None);
    }
}
