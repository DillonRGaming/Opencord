// Escape closes whatever was opened last (a side panel, the image viewer, settings…).
const stack = [];

document.addEventListener('keydown', (event) => {
  if (event.key !== 'Escape' || !stack.length) return;
  event.preventDefault();
  stack.at(-1)();
});

export function onEscape(close) {
  stack.push(close);
  return () => {
    const index = stack.indexOf(close);
    if (index !== -1) stack.splice(index, 1);
  };
}
