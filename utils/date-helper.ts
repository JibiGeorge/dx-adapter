export function parseDotNetDate(value?: string | null): Date {
  if (!value) throw new Error('No date value provided');
  const match = value.match(/\/Date\((\d+)(?:[+-]\d+)?\)\//);

  if (match) {
    return new Date(Number(match[1]));
  }

  const parsed = new Date(value);
  if (!isNaN(parsed.getTime())) {
    return parsed;
  }

  throw new Error(`Invalid .NET date format: ${value}`);
}
