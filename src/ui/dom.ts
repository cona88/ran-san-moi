interface ElOptions {
  id?: string;
  className?: string;
  text?: string;
  /** Static, trusted markup only (never user input). */
  html?: string;
}

/** Tiny typed `createElement` helper to keep UI construction readable. */
export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  options: ElOptions = {},
  ...children: Array<Node | string>
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (options.id) node.id = options.id;
  if (options.className) node.className = options.className;
  if (options.text !== undefined) node.textContent = options.text;
  if (options.html !== undefined) node.innerHTML = options.html;
  node.append(...children);
  return node;
}
