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

/**
 * Format Date as DD-MM-YYYY
 */
export function formatDateDDMMYYYY(date?: Date | null): string {
  if (!date) return "";

   const months = [
    "Jan", "Feb", "Mar", "Apr", "May", "Jun",
    "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"
  ];
  
  const day = String(date.getDate()).padStart(2, "0");
  const month = months[date.getMonth()];
  const year = date.getFullYear();

  return `${day}-${month}-${year}`;
}

export function formatDateString(dateString?: string | null): string {
  if (!dateString) return '';
  const date = new Date(dateString);
  if (isNaN(date.getTime())) return '';

  const day = String(date.getDate()).padStart(2, "0");
  const month = date.toLocaleString("en-US", { month: "short" });
  const year = date.getFullYear();

  return `${day}-${month}-${year}`;
}