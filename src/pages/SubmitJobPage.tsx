import { useEffect } from "react";
import { Plus, Save, Send, Trash2 } from "lucide-react";
import { Controller, useForm } from "react-hook-form";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { useStartJobRun, useVirtualClusters } from "@/hooks/useEmr";
import { useCreateTemplate, useTemplates } from "@/hooks/useTemplates";
import { buildStartJobRunRequest } from "@/services/jobRequest";
import { useSessionStore } from "@/stores/sessionStore";
import type { ApplicationTemplate, SubmitJobFormValues } from "@/types/domain";

export function SubmitJobPage() {
  const setSelectedVirtualClusterId = useSessionStore((state) => state.setSelectedVirtualClusterId);
  const clonedJobRequest = useSessionStore((state) => state.clonedJobRequest);
  const setClonedJobRequest = useSessionStore((state) => state.setClonedJobRequest);
  const clusters = useVirtualClusters();
  const startJobRun = useStartJobRun();
  const templates = useTemplates();
  const createTemplate = useCreateTemplate();
  const form = useForm<SubmitJobFormValues>({
    defaultValues: {
      name: "",
      virtualClusterId: "",
      executionRoleArn: "",
      releaseLabel: "emr-7.2.0-latest",
      application: {
        type: "jar",
        jarPath: "",
        mainClass: ""
      },
      arguments: [],
      resources: {
        driverCores: 1,
        driverMemory: "2G",
        executorCores: 2,
        executorMemory: "4G",
        executorInstances: 2
      },
      sparkConfig: {}
    }
  });

  useEffect(() => {
    if (!clonedJobRequest) return;
    form.reset({
      name: `${clonedJobRequest.name}-copy`,
      virtualClusterId: clonedJobRequest.virtualClusterId,
      executionRoleArn: clonedJobRequest.executionRoleArn,
      releaseLabel: clonedJobRequest.releaseLabel,
      application: clonedJobRequest.application,
      arguments: clonedJobRequest.arguments,
      resources: clonedJobRequest.resources,
      sparkConfig: clonedJobRequest.sparkConfig
    });
    setSelectedVirtualClusterId(clonedJobRequest.virtualClusterId);
    setClonedJobRequest(undefined);
    toast.success("Job configuration loaded into Submit Job.");
  }, [clonedJobRequest, form, setClonedJobRequest, setSelectedVirtualClusterId]);

  const submit = form.handleSubmit(async (values) => {
    try {
      const request = buildStartJobRunRequest(values);
      const job = await startJobRun.mutateAsync(request);
      toast.success(`Submitted ${job.name}`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to submit job.");
    }
  });

  const saveApplicationTemplate = async () => {
    const values = form.getValues();
    const now = new Date().toISOString();
    const template: ApplicationTemplate = {
      id: crypto.randomUUID(),
      name: values.name || "Untitled application",
      description: "",
      jarPath: values.application.jarPath,
      mainClass: values.application.mainClass,
      defaultArguments: values.arguments,
      sparkConfig: values.sparkConfig,
      createdAt: now,
      updatedAt: now
    };

    try {
      await createTemplate.mutateAsync(template);
      toast.success("Application template saved.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to save template.");
    }
  };

  return (
    <form className="flex flex-col gap-6" onSubmit={submit}>
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Submit Job</h1>
          <p className="text-sm text-muted-foreground">Submit Jar-based Spark jobs to EMR Virtual Clusters.</p>
        </div>
        <div className="flex gap-2">
          <Button type="button" variant="outline" disabled={createTemplate.isPending} onClick={saveApplicationTemplate}>
            <Save data-icon="inline-start" />
            Save Template
          </Button>
          <Button type="submit" disabled={startJobRun.isPending}>
            <Send data-icon="inline-start" />
            {startJobRun.isPending ? "Submitting..." : "Submit"}
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-[1fr_320px] gap-6">
        <div className="flex flex-col gap-6">
          <Card>
            <CardHeader>
              <CardTitle>Basic Information</CardTitle>
              <CardDescription>Name the job and choose where it should run.</CardDescription>
            </CardHeader>
            <CardContent className="grid grid-cols-2 gap-4">
              <Field label="Job Name">
                <Input placeholder="daily-etl" {...form.register("name", { required: true })} />
              </Field>
              <Field label="Virtual Cluster">
                <Controller
                  control={form.control}
                  name="virtualClusterId"
                  render={({ field }) => (
                    <Select
                      value={field.value}
                      onValueChange={(value) => {
                        field.onChange(value);
                        setSelectedVirtualClusterId(value);
                      }}
                    >
                      <SelectTrigger>
                        <SelectValue placeholder="Select cluster" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectGroup>
                          {(clusters.data?.clusters ?? []).map((cluster) => (
                            <SelectItem key={cluster.id} value={cluster.id}>
                              {cluster.name} / {cluster.namespace}
                            </SelectItem>
                          ))}
                        </SelectGroup>
                      </SelectContent>
                    </Select>
                  )}
                />
              </Field>
              <Field className="col-span-2" label="Execution Role ARN">
                <Input
                  placeholder="arn:aws:iam::123456789012:role/EMRContainers-JobExecutionRole"
                  {...form.register("executionRoleArn", { required: true })}
                />
              </Field>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Application</CardTitle>
              <CardDescription>Jar is the supported application type for this version.</CardDescription>
            </CardHeader>
            <CardContent className="grid grid-cols-2 gap-4">
              <Field className="col-span-2" label="Load Application Template">
                <Select
                  onValueChange={(id) => {
                    const template = templates.data?.applicationTemplates.find((item) => item.id === id);
                    if (!template) return;
                    form.setValue("application.jarPath", template.jarPath);
                    form.setValue("application.mainClass", template.mainClass);
                    form.setValue("arguments", template.defaultArguments);
                    form.setValue("sparkConfig", template.sparkConfig);
                    toast.success(`Loaded ${template.name}.`);
                  }}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Choose an application template" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectGroup>
                      {(templates.data?.applicationTemplates ?? []).map((template) => (
                        <SelectItem key={template.id} value={template.id}>
                          {template.name}
                        </SelectItem>
                      ))}
                    </SelectGroup>
                  </SelectContent>
                </Select>
              </Field>
              <Field label="Jar Path (S3)">
                <Input placeholder="s3://bucket/jobs/app.jar" {...form.register("application.jarPath", { required: true })} />
              </Field>
              <Field label="Main Class">
                <Input placeholder="com.example.Main" {...form.register("application.mainClass", { required: true })} />
              </Field>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Arguments</CardTitle>
              <CardDescription>One Spark argument per line.</CardDescription>
            </CardHeader>
            <CardContent>
              <Textarea
                className="font-mono"
                placeholder={"--date=2026-06-09\n--env=prod"}
                value={form.watch("arguments").join("\n")}
                onChange={(event) => form.setValue("arguments", event.target.value.split("\n"))}
              />
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Advanced Spark Configuration</CardTitle>
              <CardDescription>Key-value properties are translated to spark-submit `--conf` flags.</CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-3">
              {Object.entries(form.watch("sparkConfig")).map(([key, value]) => (
                <div key={key} className="grid grid-cols-[1fr_1fr_auto] gap-3">
                  <Input
                    value={key}
                    onChange={(event) => {
                      const next = { ...form.getValues("sparkConfig") };
                      delete next[key];
                      next[event.target.value] = value;
                      form.setValue("sparkConfig", next);
                    }}
                  />
                  <Input
                    value={value}
                    onChange={(event) =>
                      form.setValue("sparkConfig", {
                        ...form.getValues("sparkConfig"),
                        [key]: event.target.value
                      })
                    }
                    placeholder="200"
                  />
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    aria-label={`Remove ${key}`}
                    onClick={() => {
                      const next = { ...form.getValues("sparkConfig") };
                      delete next[key];
                      form.setValue("sparkConfig", next);
                    }}
                  >
                    <Trash2 data-icon="inline-start" />
                  </Button>
                </div>
              ))}
              <Button
                type="button"
                variant="outline"
                className="w-fit"
                onClick={() =>
                  form.setValue("sparkConfig", {
                    ...form.getValues("sparkConfig"),
                    [`spark.conf.${Object.keys(form.getValues("sparkConfig")).length + 1}`]: ""
                  })
                }
              >
                <Plus data-icon="inline-start" />
                Add Config
              </Button>
            </CardContent>
          </Card>
        </div>

        <Card className="h-fit">
          <CardHeader>
            <CardTitle>Resource Configuration</CardTitle>
            <CardDescription>Driver and executor sizing.</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            <Field label="Load Resource Template">
              <Select
                onValueChange={(id) => {
                  const template = templates.data?.resourceTemplates.find((item) => item.id === id);
                  if (!template) return;
                  form.setValue("resources", template.resources);
                  toast.success(`Loaded ${template.name}.`);
                }}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Choose resources" />
                </SelectTrigger>
                <SelectContent>
                  <SelectGroup>
                    {(templates.data?.resourceTemplates ?? []).map((template) => (
                      <SelectItem key={template.id} value={template.id}>
                        {template.name}
                      </SelectItem>
                    ))}
                  </SelectGroup>
                </SelectContent>
              </Select>
            </Field>
            <Field label="Driver Cores">
              <Input type="number" {...form.register("resources.driverCores", { valueAsNumber: true })} />
            </Field>
            <Field label="Driver Memory">
              <Input {...form.register("resources.driverMemory")} />
            </Field>
            <Field label="Executor Cores">
              <Input type="number" {...form.register("resources.executorCores", { valueAsNumber: true })} />
            </Field>
            <Field label="Executor Memory">
              <Input {...form.register("resources.executorMemory")} />
            </Field>
            <Field label="Executor Instances">
              <Input type="number" {...form.register("resources.executorInstances", { valueAsNumber: true })} />
            </Field>
          </CardContent>
        </Card>
      </div>
    </form>
  );
}

function Field({
  label,
  children,
  className
}: {
  label: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={`flex flex-col gap-2 ${className ?? ""}`}>
      <Label>{label}</Label>
      {children}
    </div>
  );
}
