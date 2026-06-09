import { Copy, Edit2, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useDuplicateTemplate, useTemplates } from "@/hooks/useTemplates";

export function TemplatesPage() {
  const templates = useTemplates();
  const duplicate = useDuplicateTemplate();
  const applications = templates.data?.applicationTemplates ?? [];
  const resources = templates.data?.resourceTemplates ?? [];

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Templates</h1>
          <p className="text-sm text-muted-foreground">Manage reusable application and resource templates.</p>
        </div>
        <Button>
          <Plus data-icon="inline-start" />
          Create Template
        </Button>
      </div>
      <Tabs defaultValue="application">
        <TabsList>
          <TabsTrigger value="application">Application Template</TabsTrigger>
          <TabsTrigger value="resource">Resource Template</TabsTrigger>
        </TabsList>
        <TabsContent value="application">
          <TemplateCards
            items={applications.map((template) => [template.id, template.name, template.jarPath, template.mainClass])}
            type="application"
            onDuplicate={(id) => duplicate.mutate({ id, type: "application" })}
          />
        </TabsContent>
        <TabsContent value="resource">
          <TemplateCards
            items={resources.map((template) => [
              template.id,
              template.name,
              `${template.resources.executorInstances} executors`,
              `${template.resources.executorCores} cores / ${template.resources.executorMemory} executor memory`
            ])}
            type="resource"
            onDuplicate={(id) => duplicate.mutate({ id, type: "resource" })}
          />
        </TabsContent>
      </Tabs>
    </div>
  );
}

function TemplateCards({
  items,
  type,
  onDuplicate
}: {
  items: string[][];
  type: "application" | "resource";
  onDuplicate: (id: string) => void;
}) {
  return (
    <div className="grid grid-cols-2 gap-4 pt-4">
      {items.map(([id, title, line1, line2]) => (
        <Card key={id}>
          <CardHeader>
            <CardTitle>{title}</CardTitle>
            <CardDescription>{line1}</CardDescription>
          </CardHeader>
          <CardContent className="flex items-center justify-between gap-4">
            <span className="text-sm text-muted-foreground">{line2}</span>
            <div className="flex gap-2">
              <Button variant="ghost" size="icon" aria-label={`Edit ${title}`}>
                <Edit2 data-icon="inline-start" />
              </Button>
              <Button variant="ghost" size="icon" aria-label={`Duplicate ${title}`} onClick={() => onDuplicate(id)}>
                <Copy data-icon="inline-start" />
              </Button>
              <Button variant="ghost" size="icon" aria-label={`Delete ${title}`}>
                <Trash2 data-icon="inline-start" />
              </Button>
            </div>
          </CardContent>
        </Card>
      ))}
      {items.length === 0 ? (
        <Card className="col-span-2">
          <CardHeader>
            <CardTitle>No {type} templates</CardTitle>
            <CardDescription>Create a template from the Submit Job page.</CardDescription>
          </CardHeader>
        </Card>
      ) : null}
    </div>
  );
}
