import readline from 'readline';
import { Writable } from 'stream';
import { initDb, closeDb, setAuthUser } from './db';
import {
  hashPassword,
  PASSWORD_MIN_LENGTH,
  PASSWORD_MAX_LENGTH,
  USERNAME_MAX_LENGTH,
} from './auth/password';

/**
 * `npm run set-password` — creates or resets the single operator account.
 *
 * Compiled into dist/ with everything else, so it also runs in the production
 * Docker image, which has no dev dependencies and no ts-node. It opens its own
 * connection to flights.db and is safe to run while the server holds the
 * database open in WAL mode — the change takes effect on the next login
 * attempt, with no restart.
 *
 * The password is only ever read from the terminal or from stdin, never from
 * argv: an argument is visible in `ps` and in shell history.
 */

const USAGE = 'Usage: node dist/setPassword.js [--username <name>]   (password is read from the terminal, or from stdin when piped)';

function fail(message: string): never {
  console.error(message);
  process.exit(1);
}

function parseUsername(argv: string[]): string {
  let username = 'operator';
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--username' || arg.startsWith('--username=')) {
      const value = arg.startsWith('--username=') ? arg.slice('--username='.length) : argv[++i];
      if (value === undefined) fail('--username needs a value.');
      username = value;
      continue;
    }
    // Deliberately rejected rather than read: an argument is visible in `ps`
    // and lands in shell history.
    if (arg === '--password' || arg.startsWith('--password=')) {
      fail(`This tool never takes a password as an argument — it would be visible in \`ps\` and in shell history.\n${USAGE}`);
    }
    if (arg === '--help' || arg === '-h') {
      console.log(USAGE);
      process.exit(0);
    }
    fail(`Unrecognised argument "${arg}".\n${USAGE}`);
  }
  return username.trim();
}

/**
 * Reads one line from the terminal with echo disabled. `terminal: true` plus a
 * writable that drops everything after the prompt has been written is what
 * keeps the typed characters off the screen.
 */
function promptHidden(query: string): Promise<string> {
  return new Promise(resolve => {
    let muted = false;
    const output = new Writable({
      write(chunk, _encoding, callback) {
        if (!muted) process.stdout.write(chunk);
        callback();
      },
    });
    const rl = readline.createInterface({ input: process.stdin, output, terminal: true });
    rl.question(query, answer => {
      rl.close();
      process.stdout.write('\n');
      resolve(answer);
    });
    muted = true;
  });
}

/**
 * The automation path: the first line of stdin is the password.
 *   printf '%s\n' "$PW" | docker compose run --rm -T msfslogger node dist/setPassword.js
 * Only the line terminator is stripped — every other character, including
 * leading and trailing spaces, is part of the password.
 */
async function readFirstLine(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) chunks.push(Buffer.from(chunk));
  const first = Buffer.concat(chunks).toString('utf8').split('\n')[0];
  return first.endsWith('\r') ? first.slice(0, -1) : first;
}

async function main(): Promise<void> {
  const username = parseUsername(process.argv.slice(2));
  if (username.length < 1 || username.length > USERNAME_MAX_LENGTH) {
    fail(`Username must be 1-${USERNAME_MAX_LENGTH} characters.`);
  }

  const interactive = Boolean(process.stdin.isTTY);
  const password = interactive ? await promptHidden('Password: ') : await readFirstLine();

  if (password.length < PASSWORD_MIN_LENGTH) fail(`Password must be at least ${PASSWORD_MIN_LENGTH} characters.`);
  if (password.length > PASSWORD_MAX_LENGTH) fail(`Password must be at most ${PASSWORD_MAX_LENGTH} characters.`);
  if (password.trim().length === 0) fail('Password must not be blank.');

  if (interactive) {
    const confirm = await promptHidden('Confirm password: ');
    if (confirm !== password) fail('Passwords do not match.');
  }

  initDb();
  try {
    setAuthUser(username, hashPassword(password));
  } finally {
    closeDb();
  }

  console.log(`Password set for user "${username}".`);
}

main().catch(err => {
  console.error('Setting the password failed:', err instanceof Error ? err.message : err);
  process.exit(1);
});
