/** Polaris web-component event helpers (ported from Genie). */

export type ChoiceListElement = HTMLElement & { values: string[] };
export type MoneyFieldElement = HTMLElement & { value: string };
export type NumberFieldElement = HTMLElement & { value: string };
export type SelectElement = HTMLElement & { value: string };
export type DropZoneElement = HTMLElement & {
  files: File[];
  value: string;
  error: string;
};
export type CheckboxElement = HTMLElement & {
  checked: boolean;
  value: string;
};
export type DatePickerElement = HTMLElement & { value: string };
export type ModalElement = HTMLElement & { hideOverlay: () => void };

export function fieldValue(event: Event) {
  return (event.currentTarget as HTMLInputElement).value;
}

export function selectValue(event: Event) {
  return (event.currentTarget as SelectElement).value;
}

export function numberValue(event: Event) {
  return (event.currentTarget as NumberFieldElement).value;
}

export function moneyValue(event: Event) {
  return (event.currentTarget as MoneyFieldElement).value;
}

export function checkedValue(event: Event) {
  const el = (event.currentTarget ?? event.target) as HTMLInputElement | null;
  return Boolean(el?.checked);
}

export function choiceValues(event: Event) {
  return (event.currentTarget as ChoiceListElement).values;
}
