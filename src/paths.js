import os from 'node:os';
import path from 'node:path';

/**
 * Work out every folder skill-atlas looks at, for the given OS and home folder.
 * Nothing here touches the disk, so it can be tested with made-up values.
 *
 * @param {{home?: string, platform?: string, env?: Record<string,string|undefined>, projects?: string[], cwd?: string}} [opts]
 */
export function resolveRoots(opts = {}) {
  const home = opts.home ?? os.homedir();
  const platform = opts.platform ?? process.platform;
  const env = opts.env ?? process.env;
  const claudeDir = env.CLAUDE_CONFIG_DIR || path.join(home, '.claude');

  let desktopAppDir;
  if (platform === 'darwin') {
    desktopAppDir = path.join(home, 'Library', 'Application Support', 'Claude');
  } else if (platform === 'win32') {
    desktopAppDir = path.join(env.APPDATA || path.join(home, 'AppData', 'Roaming'), 'Claude');
  } else {
    desktopAppDir = path.join(env.XDG_CONFIG_HOME || path.join(home, '.config'), 'Claude');
  }

  const projects = [...new Set((opts.projects ?? []).map((p) => path.resolve(opts.cwd ?? process.cwd(), p)))];

  return {
    home,
    claudeDir,
    userSkills: path.join(claudeDir, 'skills'),
    userAgents: path.join(claudeDir, 'agents'),
    userCommands: path.join(claudeDir, 'commands'),
    settings: path.join(claudeDir, 'settings.json'),
    installedPlugins: path.join(claudeDir, 'plugins', 'installed_plugins.json'),
    syncedSkills: path.join(claudeDir, 'skills', 'synced'),
    syncedPlugins: path.join(claudeDir, 'plugins', 'synced'),
    desktopSessions: path.join(desktopAppDir, 'local-agent-mode-sessions'),
    agentSkillDirs: [
      path.join(home, '.agents', 'skills'),
      path.join(home, '.codex', 'skills'),
      path.join(home, '.cursor', 'skills'),
      path.join(home, '.gemini', 'skills'),
    ],
    projects,
  };
}

/** Replace the home folder with `~` so shared output never shows the account name. */
export function tildify(p, home = os.homedir()) {
  if (!p) return p;
  if (p === home) return '~';
  if (p.startsWith(home + path.sep)) return '~' + p.slice(home.length).split(path.sep).join('/');
  return p;
}

/** Where summaries are cached. Lives outside the repository on purpose. */
export function cacheFile(env = process.env, home = os.homedir(), platform = process.platform) {
  if (env.SKILL_ATLAS_CACHE) return env.SKILL_ATLAS_CACHE;
  const base =
    platform === 'win32'
      ? env.LOCALAPPDATA || path.join(home, 'AppData', 'Local')
      : env.XDG_CACHE_HOME || path.join(home, '.cache');
  return path.join(base, 'skill-atlas', 'summaries.json');
}
