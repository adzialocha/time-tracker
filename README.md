# time-tracker

## Setup

```bash
# Install dependencies
npm install

# Copy your GitHub authentication token into the file
vim ./token.txt
```

## Usage

```bash
# Fetch data and analyse it
npm start

# Only fetch data
npm run fetch

# Only analyse data (after you've fetched it)
npm run analyse

# Remove all downloaded data
npm run clear
```

### Arguments

#### `fetch`

```
-d, --data <name>          Name of the data folder (default: "data")
-t, --auth-token <path>    Path to file holding GitHub API auth token (default:
                           "./token.txt")
-f, --from <date>          Download data from that date on, formatted as ISO
                           8601 string (default: "2022-09-01T00:00:00")
-o, --organisation <name>  GitHub organisation name (default: "p2panda")
-a, --author <username>    GitHub username (default: "adzialocha")
-h, --help                 display help for command
```

#### `analyse`

```
-d, --data <name>          Name of the data folder (default: "data")
-f, --from <date>          Analyse data from that date on, formatted as ISO
                           8601 string (default: "2021-09-01T00:00:00")
-t, --to <date>            Analyse data until that date, formatted as ISO
                           8601 string (default: "2022-09-30T23:59:59")
-d, --threshold <minutes>  Consider a working phase within this duration
                           (default: 240)
-h, --help                 display help for command
```
