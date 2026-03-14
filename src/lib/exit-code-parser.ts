import { ShellType } from './types';

/** SGR escape sequences — the only ANSI codes the Rust filter passes through. */
// eslint-disable-next-line no-control-regex
const SGR_REGEX = /\x1b\[[0-9;]*m/g;

/** Match the exit marker only when it starts at the beginning of a line. */
const EXIT_CODE_REGEX = /^VELOCITY_EXIT:(-?\d+)\r?$/m;

/**
 * Strip SGR escape sequences from text.
 * Used internally so the exit-code regex can match even when ConPTY
 * wraps marker text in color/reset sequences.
 */
function stripSgr(text: string): string {
  return text.replace(SGR_REGEX, '');
}

/**
 * Build a regex that matches a VELOCITY_EXIT marker line, allowing optional
 * SGR escape sequences before, inside, or after the marker text.
 * The pattern is anchored to the start of a line and tolerates \r before EOL.
 */
const SGR_OPT = '(?:\\x1b\\[[0-9;]*m)*';
// eslint-disable-next-line no-control-regex
const EXIT_CODE_STRIP_RAW_REGEX = new RegExp(
  `^${SGR_OPT}VELOCITY_EXIT:${SGR_OPT}(-?\\d+)${SGR_OPT}\\r?\\n?`,
  'gm',
);

/**
 * Extract an exit code marker from accumulated PTY output.
 *
 * The marker format is `VELOCITY_EXIT:<code>` on its own line.
 * If found, strips the marker from the output and returns the parsed exit code.
 * If not found, returns the output unchanged with exitCode null.
 *
 * The match is performed on SGR-stripped text so that ConPTY color/reset
 * sequences around the marker don't prevent detection.
 */
export function extractExitCode(output: string): { cleanOutput: string; exitCode: number | null } {
  // Match against SGR-stripped text so color codes don't break detection
  const stripped = stripSgr(output);
  const match = stripped.match(EXIT_CODE_REGEX);
  if (match) {
    const exitCode = parseInt(match[1], 10);
    // Strip marker lines from the original (SGR-containing) output
    const cleanOutput = output.replace(EXIT_CODE_STRIP_RAW_REGEX, '');
    return { cleanOutput, exitCode };
  }
  return { cleanOutput: output, exitCode: null };
}

/**
 * Get the shell-specific command suffix that echoes the exit code marker.
 *
 * This is appended to the user's command before sending to the PTY,
 * so the output stream contains a parseable exit code.
 */
export function getExitCodeMarker(shellType: ShellType): string {
  switch (shellType) {
    case 'powershell':
      return '; if ($?) { Write-Output "VELOCITY_EXIT:0" } else { Write-Output "VELOCITY_EXIT:1" }';
    case 'cmd':
      return '& echo VELOCITY_EXIT:%ERRORLEVEL%';
    case 'wsl':
      return '; echo "VELOCITY_EXIT:$?"';
  }
}
