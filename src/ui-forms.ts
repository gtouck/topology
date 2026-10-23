/** Field errors keep the current form and open any collapsed ancestor sections. */
export function clearFieldErrors(root: HTMLElement) {
  root.querySelectorAll('[data-field-error]').forEach((error) => error.remove());
  root.querySelectorAll('[aria-invalid="true"]').forEach((field) => {
    const errorId = `${field.id}-error`;
    const describedBy = field.getAttribute('aria-describedby')?.split(' ').filter((id) => id !== errorId).join(' ');
    field.removeAttribute('aria-invalid');
    if (describedBy) field.setAttribute('aria-describedby', describedBy); else field.removeAttribute('aria-describedby');
  });
}

export function showFieldError(id: string, message: string) {
  const field = document.getElementById(id); if (!field) return;
  let parent = field.parentElement;
  while (parent) { if (parent instanceof HTMLDetailsElement) parent.open = true; parent = parent.parentElement; }
  const error = document.createElement('p');
  error.id = `${id}-error`; error.className = 'field-error'; error.dataset.fieldError = id; error.setAttribute('role', 'alert'); error.textContent = message;
  document.getElementById(error.id)?.remove();
  field.insertAdjacentElement('afterend', error);
  field.setAttribute('aria-invalid', 'true');
  field.setAttribute('aria-describedby', [...new Set([...(field.getAttribute('aria-describedby') || '').split(' ').filter(Boolean), error.id])].join(' '));
  field.focus({ preventScroll: true }); field.scrollIntoView({ block: 'nearest' });
}
