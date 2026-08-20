// Cavalry's dropdowns are listboxes rather than native <select> elements, so
// tests open the menu and click an option instead of calling selectOptions,
// and read the current choice from the trigger's label rather than `.value`.

import { screen, within } from '@testing-library/react';

// Account options carry a detail suffix ("Cash — Bank account · PHP 4,800.00"),
// so a plain string matches on the option's leading label.
function optionMatcher(name) {
  if (name instanceof RegExp) return name;
  return (accessibleName) => accessibleName === name || accessibleName.startsWith(`${name} —`);
}

export async function openOptions(user, combobox) {
  await user.click(combobox);
  return screen.findByRole('listbox');
}

export async function chooseOption(user, combobox, optionName) {
  const listbox = await openOptions(user, combobox);
  await user.click(within(listbox).getByRole('option', { name: optionMatcher(optionName) }));
}

export function selectedOptionLabel(combobox) {
  return combobox.textContent.trim();
}
