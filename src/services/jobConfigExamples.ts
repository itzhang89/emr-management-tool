export function defaultExamplePayload() {
  return `{
  "name": "\${template_name}-\${submitUser}-\${date:YYYY-MM-DD}",
  "virtualClusterId": "\${virtualClusterId}",
  "executionRoleArn": "arn:aws:iam::123456789012:role/EMRContainers-JobExecutionRole",
  "releaseLabel": "emr-7.2.0-latest",
  "jobDriver": {
    "sparkSubmitJobDriver": {
      "entryPoint": "s3://bucket/jobs/app.jar",
      "entryPointArguments": ["--env=\${ENV}"],
      "sparkSubmitParameters": "--class com.example.Main"
    }
  },
  "configurationOverrides": {
    "applicationConfiguration": [
      {
        "classification": "spark-defaults",
        "properties": {
          "spark.driver.cores": "1",
          "spark.driver.memory": "1G",
          "spark.executor.cores": "1",
          "spark.executor.memory": "1G",
          "spark.executor.instances": "1"
        }
      }
    ],
    "monitoringConfiguration": {
      "cloudWatchMonitoringConfiguration": {
        "logGroupName": "/aws/emr-containers/jobs",
        "logStreamNamePrefix": "\${submitUser}"
      }
    }
  }
}`;
}
