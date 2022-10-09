import fs from 'fs';

import { Command } from 'commander';
import { Octokit } from 'octokit';
import chalk from 'chalk';

const PAGE_SIZE = 100;
const DATA_FOLDER_NAME = 'data';

// Parse user arguments
const program = new Command();

program
  .name('time-tracking')
  .description('Because adz was lazy')
  .option(
    '-t, --auth-token <path>',
    'Path to file holding GitHub API auth token',
    './token.txt',
  )
  .option(
    '-f, --from <date>',
    'Download data from that date on, formatted as ISO 8601 string',
    '2021-09-01T00:00:00',
  )
  .option(
    '-o, --organisation <name>',
    'GitHub organisation name',
    'p2panda',
  )
  .option(
    '-a, --author <username>',
    'GitHub username',
    'adzialocha',
  );

program.parse();
const options = program.opts();

// Load authentication token for GitHub API
let authToken;
try {
  authToken = fs.readFileSync(options.authToken, 'utf-8').replace('\n', '');
} catch {
  throw new Error(`GitHub personal authentication token for API missing in "${options.authToken}" file`);
}

// Initialise GitHub API tool
const octokit = new Octokit({
  auth: authToken,
});

// =======
// Helpers
// =======

function truncate(str, len = 50) {
  if (str.length <= len) {
    return str;
  }

  return `${str.slice(0, len)} ...`;
}

function printTitle(title) {
  const line = title
    .split('')
    .reduce((acc, _, index) => {
      acc.push(index % 2 === 0 ? '❉' : ' ');
      return acc;
    }, [])
    .join('');

  console.log(chalk.bgMagenta.black.bold(line));
  console.log(chalk.bgMagenta.black.bold(title));
  console.log(chalk.bgMagenta.black.bold(line));
  console.log();
}

function printSubtitle(str) {
  console.log(chalk.bgMagenta.black.bold(str));
  console.log();
}

function printCommit({ commit, author, sha }, pullRequestId) {
  const firstLine = commit.message.split('\n')[0];

  console.log(
    [
      commit.author.date,
      chalk.red(author.login.padEnd(10)),
      chalk.yellow(sha.slice(0, 8)),
      `"${truncate(firstLine)}"`,
      pullRequestId && chalk.bold(pullRequestId ? `(#${pullRequestId})` : ''),
    ].join(' ')
  );
}

// ===============
// Write JSON file
// ===============

function writeFile(repo, data) {
  const filePath = `./${DATA_FOLDER_NAME}/${repo}.json`;
  printSubtitle(`Write data to ${filePath}`);
  fs.writeFileSync(filePath, JSON.stringify(data), 'utf8');
  console.log();
}

// ================================
// Make requests against GitHub API
// ================================

async function requestOne(path, args) {
  const { data, url } = await octokit.request(`GET ${path}`, {
    ...args,
  });

  console.log(`⇓ Fetched ${chalk.blue(url)}`);

  return data;
}

async function requestAll(path, args) {
  const result = [];
  let page = 1;

  while (true) {
    const response = await octokit.request(`GET ${path}`, {
      ...args,
      per_page: PAGE_SIZE,
      since: options.from,
      author: options.author,
      page,
    });

    console.log(`⇓ Fetched ${chalk.blue(response.url)}`);

    if (response.data.length > 0) {
      response.data.forEach((item) => {
        result.push(item);
      });

      page += 1;
    } else {
      break;
    }
  }

  return result;
}

// =============================
// Methods to gather commit data
// =============================

function findPullRequest({ commit }) {
  const firstLine = commit.message.split('\n')[0];

  const matches = [...firstLine.matchAll(/\(\#(\d+)\)/g)];
  const pullRequestId =
    matches && matches.length === 1 ? parseInt(matches[0][1], 10) : undefined;

  return pullRequestId;
}

function filterPlainCommits(commits) {
  printSubtitle('Filter all commits not resulting from squash merge');

  const filtered = commits.filter((commit) => {
    return !commit.__isSquashMerge;
  });

  console.log(`✔ Got ${chalk.bold(filtered.length)} commits\n`);

  return filtered;
}

async function fetchRepositories() {
  printSubtitle(`Fetch all repositories of ${options.organisation}`);

  const repositories = await requestAll('/orgs/{org}/repos', {
    org: options.organisation,
  });

  console.log(`✔ Got ${chalk.bold(repositories.length)} repositories\n`);

  return repositories;
}

async function fetchAllCommits(owner, repo) {
  printSubtitle(`Fetch all commits from ${options.from}`);

  // Get all commits
  const commits = await requestAll('/repos/{owner}/{repo}/commits', {
    owner,
    repo,
  });

  console.log(`✔ Got ${chalk.bold(commits.length)} commits\n`);

  return commits;
}

function findAssociatedPRs(commits) {
  printSubtitle('Find associated pull requests');

  const pullRequestIds = [];

  for (const commit of commits) {
    // GitHub doesn't tell us if the commit came from a PR (it only gives us the
    // PR when it is still open ..), so we need to detect manually if this commit
    // comes from a PR by looking at its message
    const pullRequestId = findPullRequest(commit);

    if (pullRequestId !== undefined) {
      pullRequestIds.push(pullRequestId);
    }

    printCommit(commit, pullRequestId);

    // Add these additional information to the commit itself
    commit.__isSquashMerge = pullRequestId !== undefined;
    commit.__isFromPullRequest = false;
    commit.__pullRequestId = pullRequestId;
  }

  console.log(`✔ Got ${chalk.bold(pullRequestIds.length)} PRs\n`);

  return pullRequestIds;
}

async function fetchCommitsInPullRequest(owner, repo, pullRequestId) {
  printSubtitle(`Fetch commits from pull request #${pullRequestId}`);

  const commits = await requestAll(
    '/repos/{owner}/{repo}/pulls/{pull_number}/commits',
    {
      owner,
      repo,
      pull_number: pullRequestId,
    }
  );

  console.log(`✔ Got ${chalk.bold(commits.length)} commits\n`);

  for (const commit of commits) {
    printCommit(commit, pullRequestId);

    // Add these additional information to the commit itself
    commit.__isSquashMerge = false;
    commit.__isFromPullRequest = true;
    commit.__pullRequestId = pullRequestId;
  }

  console.log();

  return commits;
}

async function fetchCommitStats(owner, repo, ref) {
  printSubtitle(`Fetch commit statistics for ${ref.slice(0, 8)}`);

  const { commit, stats, files } = await requestOne(
    '/repos/{owner}/{repo}/commits/{ref}',
    {
      owner,
      repo,
      ref,
    }
  );

  console.log(
    [
      `✔ Files: ${chalk.bold(files.length)}`,
      `Changes: ${chalk.yellow.bold(stats.total)}`,
      `Additions: ${chalk.green.bold(stats.additions)}`,
      `Deletions: ${chalk.red.bold(stats.deletions)}`,
      `Commit: ${commit.author.date} "${truncate(commit.message, 24)}"`,
    ].join(', ')
  );
  console.log();

  return {
    ...stats,
    files: files.length,
  };
}

async function getCommitData(owner, repo) {
  const commits = await fetchAllCommits(owner, repo);
  const pullRequestIds = findAssociatedPRs(commits);

  const pullRequests = {};
  for (const pullRequestId of pullRequestIds) {
    const prCommits = await fetchCommitsInPullRequest(
      owner,
      repo,
      pullRequestId
    );

    // Add all PR commits to the others
    for (const commit of prCommits) {
      commits.push(commit);
    }

    // .. and keep them additionally organized by PR id
    pullRequests[pullRequestId] = prCommits;
  }

  // Remove all commits coming from squash merges, also remove duplicates
  const { plainCommits } = filterPlainCommits(commits)
    .reduce((acc, commit) => {
      if (!acc.hashes.includes(commit.sha)) {
        acc.hashes.push(commit.sha);
        acc.plainCommits.push(commit);
      }

      return acc;
    }, { plainCommits: [], hashes: [] });

  for await (const commit of plainCommits) {
    const stats = await fetchCommitStats(owner, repo, commit.sha);
    commit.__stats = stats;
  }

  return plainCommits.map((commit) => {
    return {
      author: commit.author.login,
      date: commit.commit.author.date,
      message: commit.commit.message,
      pullRequestId: commit.__pullRequestId ? commit.__pullRequestId : null,
      sha: commit.sha,
      stats: commit.__stats,
    };
  });
}

// =============================
// Methods to gather issues data
// =============================

async function getIssueData(owner, repo) {
  printSubtitle(`Fetch all issue events for ${repo}`);

  const events = await requestAll('/repos/{owner}/{repo}/issues/events', {
    owner,
    repo,
  });

  // The GitHub API does not filter for us by date and author, so we do it here manually
  const filtered = events.filter((event) => {
    console.log(event.created_at >= options.from);
    return event.created_at >= options.from && event.actor.login === options.author;
  });

  // Gather some statistics about type of events (just for fun)
  const counter = filtered.reduce((acc, { event: eventType }) => {
    if (!(eventType in acc)) {
      acc[eventType] = 0;
    }

    acc[eventType] += 1;
    return acc;
  }, {});

  console.log(
    `✔ Got ${chalk.bold(filtered.length)} events ` +
      Object.keys(counter)
        .map((eventType) => {
          return `${eventType}: ${chalk.bold(counter[eventType])}`;
        })
        .join(', ')
  );

  return filtered.map((event) => {
    return {
      author: event.actor.login,
      date: event.created_at,
      eventType: event.event,
      issueId: event.issue.number,
    };
  });
}

// =========================================================
// Gather commits and issues data and write all to JSON file
// =========================================================

async function getData(owner, repo) {
  printTitle(`Repository: ${owner}/${repo}`);

  const commits = await getCommitData(owner, repo);
  const issues = await getIssueData(owner, repo);

  writeFile(repo, {
    commits,
    issues,
  });
}

// ===========
// Here we go!
// ===========

printTitle("Woho! Let's go!");
const repositories = await fetchRepositories();
for (const repo of repositories) {
  await getData(options.organisation, repo.name);
}

console.log('Done!');
