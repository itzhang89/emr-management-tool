import { useId } from "react";
import { Input } from "@/components/ui/input";
import { awsRegions } from "@/constants/awsRegions";
import { cn } from "@/lib/utils";

type AwsRegionInputProps = {
  value: string;
  onChange: (value: string) => void;
  onBlur?: () => void;
  "aria-invalid"?: boolean;
  className?: string;
};

export function AwsRegionInput({ value, onChange, onBlur, "aria-invalid": ariaInvalid, className }: AwsRegionInputProps) {
  const listId = useId();

  return (
    <>
      <Input
        className={cn(className)}
        value={value}
        list={listId}
        placeholder="eu-central-1"
        autoCapitalize="none"
        autoCorrect="off"
        spellCheck={false}
        aria-invalid={ariaInvalid}
        onBlur={onBlur}
        onChange={(event) => onChange(event.target.value)}
      />
      <datalist id={listId}>
        {awsRegions.map((region) => (
          <option key={region} value={region} />
        ))}
      </datalist>
    </>
  );
}
