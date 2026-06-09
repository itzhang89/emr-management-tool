# PROJECT.md

## Project Overview

EMR Management Tool is a cross-platform desktop application built with Tauri, React, TypeScript, and Shadcn/UI.

The primary goal is to provide a GUI-based alternative to AWS CLI for submitting and managing EMR on EKS jobs.

Target users are Data Engineers who frequently submit Spark jobs to EMR Virtual Clusters.

The application must communicate directly with AWS services through AWS SDK and must NOT depend on locally installed AWS CLI, kubectl, Java, or other external tools.

---

## Product Goals

### Primary Goals

* Submit EMR on EKS Spark jobs
* Manage Job Templates
* View Job History
* Browse CloudWatch Logs
* Browse and edit S3 text files
* Manage AWS Credentials

### Non Goals

The application is NOT intended to become a full EMR administration platform.

The following features are out of scope:

* EKS cluster management
* Kubernetes resource management
* IAM administration
* VPC management
* EMR cluster creation
* Local AWS CLI integration
* Local kubectl integration

---

## Tech Stack

### Frontend

* React 19
* TypeScript
* Vite
* Shadcn/UI
* TailwindCSS
* React Hook Form
* TanStack Query
* Zustand

### Backend

* Tauri v2
* Rust

### AWS SDK

Use official AWS Rust SDK.

Required SDKs:

* aws-sdk-emrcontainers
* aws-sdk-s3
* aws-sdk-cloudwatchlogs
* aws-sdk-sts

---

## Design Principles

### UI Style

Modern desktop application.

Inspired by:

* AWS Console
* Datagrip
* VSCode

### Layout

Desktop only.

Minimum width:

1200px

Layout structure:

Header
Sidebar
Main Content

### Component Rules

Prefer Shadcn components whenever possible.

Allowed:

* Button
* Card
* Dialog
* Drawer
* Sheet
* Select
* Input
* Table
* Tabs
* Badge
* Tooltip

Do not introduce additional UI frameworks.

Do not use:

* Ant Design
* Material UI
* Bootstrap

---

## Navigation Structure

### Dashboard

Purpose:

Quick overview of recent activities.

Widgets:

* Recent Jobs
* Running Jobs
* Favorite Templates

---

### Virtual Clusters

Purpose:

Display available EMR Virtual Clusters.

Fields:

* Name
* State
* Namespace
* EKS Cluster
* Created Time

Actions:

* Refresh
* View Details

---

### Submit Job

Most important page.

Used for submitting EMR on EKS jobs.

Current supported application type:

* Jar

Future support:

* Python
* Spark SQL

Form Sections:

#### Basic Information

* Job Name
* Virtual Cluster
* Execution Role ARN

#### Application

* Jar Path (S3)
* Main Class

#### Arguments

Dynamic argument list.

Example:

--date=2025-06-01

--env=prod

#### Resource Configuration

* Driver Cores
* Driver Memory
* Executor Cores
* Executor Memory
* Executor Instances

#### Advanced Spark Configuration

Key-value editor.

Examples:

spark.sql.shuffle.partitions

spark.dynamicAllocation.enabled

#### Actions

* Submit
* Save Template

---

### Job History

Purpose:

View previously submitted jobs.

Fields:

* Job Name
* State
* Created Time
* Duration
* Virtual Cluster

Supported States:

* PENDING
* SUBMITTED
* RUNNING
* COMPLETED
* FAILED
* CANCELLED

Actions:

* View Detail
* Clone Job
* Cancel Job

---

### Job Detail

Sections:

#### Summary

* Job Id
* State
* Virtual Cluster
* Start Time
* End Time

#### Configuration

Display complete job configuration.

#### Logs

Tabs:

* Driver Log
* Executor Log
* CloudWatch Log

Features:

* Auto Refresh
* Search
* Copy
* Download

---

### Templates

Template Types:

#### Application Template

Stores:

* Name
* Jar Path
* Main Class

#### Resource Template

Stores:

* Driver Memory
* Driver Cores
* Executor Memory
* Executor Cores
* Executor Instances

Features:

* Create
* Edit
* Delete
* Duplicate

---

### S3 Browser

Purpose:

Browse S3 buckets.

Features:

* Upload
* Download
* Delete
* Copy S3 Path

Supported Preview Types:

* sql
* yaml
* json
* conf
* properties
* txt

Supported Editing Types:

* sql
* yaml
* json
* conf
* properties
* txt

Read Only:

* jar
* parquet
* gzip
* zip

---

### Settings

#### AWS Credentials

Current supported authentication:

Access Key

Fields:

* Access Key ID
* Secret Access Key
* Region

Features:

* Test Connection
* Save Credential

Future versions may support:

* AWS Profile
* SSO
* Assume Role

---

## Backend Architecture

### Tauri Commands

Frontend should never call AWS directly.

All AWS operations must go through Tauri commands.

Example:

list_virtual_clusters

submit_job

describe_job

cancel_job

list_templates

list_s3_objects

get_cloudwatch_logs

---

## State Management

Use Zustand.

Separate stores:

* authStore
* clusterStore
* jobStore
* templateStore
* s3Store

---

## Coding Standards

### React

Use functional components only.

Do not use class components.

### TypeScript

Avoid any.

Use strict typing.

### Components

Keep components small.

Target:

* Page < 300 lines
* Component < 150 lines

### API Layer

All backend communication must be placed in:

src/services

Never call Tauri APIs directly from UI components.

---

## Future Roadmap

### Phase 2

* PySpark Job Support
* Spark SQL Job Support
* Job Scheduling
* Favorite Templates

### Phase 3

* SSO Authentication
* Multiple AWS Accounts
* Job Metrics Dashboard
* Spark History Integration

---

## Success Criteria

A user should be able to:

1. Configure AWS credentials.
2. Browse EMR Virtual Clusters.
3. Submit a Jar-based Spark job.
4. Monitor job status.
5. View CloudWatch logs.
6. Re-submit previous jobs.
7. Manage templates.
8. Edit SQL files stored in S3.

Without installing:

* AWS CLI
* kubectl
* Java Runtime
* Spark Client
