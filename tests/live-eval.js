(() => ({
  href: location.href,
  title: document.title,
  turns: document.querySelectorAll('section[data-turn]').length,
  tools: document.querySelectorAll('[data-testid="cot-v5-tool-icon-pile"]').length,
  hidden: document.querySelectorAll('[data-cgpt-tool-slim-hidden="1"]').length
}))()
