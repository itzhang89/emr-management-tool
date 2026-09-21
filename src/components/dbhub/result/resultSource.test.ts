import { describe, expect, it } from "vitest";
import { sourceName } from "./resultSource";

/**
 * The label above the result is a caption, so these cases are about giving up
 * gracefully as much as about naming the object: a blank label costs nothing,
 * a wrong one costs trust in everything else on the pane.
 */
describe("sourceName", () => {
  it("names the table after FROM", () => {
    expect(sourceName("SELECT * FROM orders")).toBe("orders");
    expect(sourceName("select id from orders where id > 1")).toBe("orders");
  });

  it("keeps the qualifier, which is what tells two same-named tables apart", () => {
    expect(sourceName('SELECT * FROM "public"."recent_failed_jobs_view" LIMIT 100;')).toBe(
      "public.recent_failed_jobs_view"
    );
    expect(sourceName("SELECT * FROM `sales`.`orders` LIMIT 100;")).toBe("sales.orders");
    expect(sourceName("SELECT * FROM [dbo].[orders]")).toBe("dbo.orders");
    expect(sourceName("SELECT * FROM public . orders")).toBe("public.orders");
  });

  it("ignores a FROM that is only inside a comment or a string", () => {
    expect(sourceName("SELECT * FROM orders -- joined from staging")).toBe("orders");
    expect(sourceName("SELECT 'from nowhere' AS label, 1 AS n FROM real_table")).toBe(
      "real_table"
    );
    expect(sourceName("/* from nothing */ SELECT * FROM t")).toBe("t");
  });

  it("gives up when there is no object to name", () => {
    expect(sourceName("SELECT 1;")).toBeUndefined();
    expect(sourceName("")).toBeUndefined();
    // A subquery is not an object, and a name invented for it would be wrong.
    expect(sourceName("SELECT * FROM (SELECT 1) AS t")).toBeUndefined();
  });

  it("reads the FROM that is really there in a CTE", () => {
    expect(sourceName("WITH t AS (SELECT 1) SELECT * FROM t")).toBe("t");
  });
});
