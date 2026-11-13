// Runs before the page paints so a saved light/dark choice never flashes the other theme.
try {
  var saved = localStorage.getItem('skill-atlas:theme');
  if (saved === 'light' || saved === 'dark') document.documentElement.dataset.theme = saved;
} catch (e) {
  /* storage blocked: follow the system theme */
}
