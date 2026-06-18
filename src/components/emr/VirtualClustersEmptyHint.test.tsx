import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { VirtualClustersEmptyHint } from "./VirtualClustersEmptyHint";

describe("VirtualClustersEmptyHint", () => {
  it("explains region mismatch as the primary cause in full mode", () => {
    render(
      <VirtualClustersEmptyHint
        accountName="test-account"
        region="eu-west-1"
        awsAccountId="123456789012"
      />
    );

    expect(screen.getByText(/No virtual clusters in eu-west-1/i)).toBeInTheDocument();
    expect(screen.getByText(/region configured for this account/i)).toBeInTheDocument();
    expect(screen.getByText("test-account")).toBeInTheDocument();
    expect(screen.getByText("123456789012")).toBeInTheDocument();
    expect(screen.getByText(/aws emr-containers list-virtual-clusters/i)).toBeInTheDocument();
  });

  it("renders a shorter hint in compact mode", () => {
    render(<VirtualClustersEmptyHint compact region="eu-west-1" />);

    expect(screen.getByText(/No virtual clusters in/i)).toBeInTheDocument();
    expect(screen.getByText(/wrong account region/i)).toBeInTheDocument();
    expect(screen.queryByText(/aws emr-containers list-virtual-clusters/i)).not.toBeInTheDocument();
  });
});
