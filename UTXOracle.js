const { execSync } = require('child_process');
const { DateTime } = require('luxon');

// Configuration options for litecoin-cli
const config = {
  datadir: "",
  rpcuser: "",
  rpcpassword: "",
  rpcookiefile: "",
  rpcconnect: "",
  rpcport: "",
  conf: ""
};

// Add the configuration options to the litecoin-cli call
const litecoinCliOptions = [];
if (config.datadir) litecoinCliOptions.push(`-datadir=${config.datadir}`);
if (config.rpcuser) litecoinCliOptions.push(`-rpcuser=${config.rpcuser}`);
if (config.rpcpassword) litecoinCliOptions.push(`-rpcpassword=${config.rpcpassword}`);
if (config.rpcookiefile) litecoinCliOptions.push(`-rpcookiefile=${config.rpcookiefile}`);
if (config.rpcconnect) litecoinCliOptions.push(`-rpcconnect=${config.rpcconnect}`);
if (config.rpcport) litecoinCliOptions.push(`-rpcport=${config.rpcport}`);
if (config.conf) litecoinCliOptions.push(`-conf=${config.conf}`);

// Shortcut function to call the node
function askNode(command) {
  const cmd = ['litecoin-cli', ...litecoinCliOptions, ...command].join(' ');
  try {
    return execSync(cmd).toString().trim();
  } catch (error) {
    console.error("Error connecting to your node. Trouble shooting steps:");
    console.error("1) Make sure litecoin-cli is working. Try command 'litecoin-cli getblockcount'");
    console.error("2) Make sure config file litecoin.conf has server=1");
    console.error("3) Explore the litecoin-cli options in this script");
    console.error("The command was: " + cmd);
    console.error("The error from litecoin-cli was:", error);
    process.exit(1);
  }
}

// Get the latest block from the node
const blockCount = parseInt(askNode(['getblockcount']));
const blockHash = askNode(['getblockhash', blockCount]);
const blockHeader = JSON.parse(askNode(['getblockheader', blockHash, 'true']));
const latestTimeInSeconds = blockHeader.time;
const latestDateTime = DateTime.fromSeconds(latestTimeInSeconds, { zone: 'utc' });
const latestPriceDate = latestDateTime.minus({ days: 1 }).toISODate();

console.log(`Connected to local node at block #: ${blockCount}`);
console.log(`Latest available price date is: ${latestPriceDate}`);
console.log("Earliest available price date is: 2020-07-26 (full node)");

// Get the desired date to estimate the price
const readline = require('readline').createInterface({
  input: process.stdin,
  output: process.stdout
});

readline.question("Enter date in YYYY-MM-DD (or 'q' to quit): ", dateEntered => {
  if (dateEntered.toLowerCase() === 'q') {
    readline.close();
    process.exit(0);
  }

  let datetimeEntered;
  try {
    datetimeEntered = DateTime.fromISO(dateEntered, { zone: 'utc' });
    if (!datetimeEntered.isValid || datetimeEntered >= latestDateTime.startOf('day')) {
      throw new Error("Invalid date");
    }

    const minDate = DateTime.fromISO("2020-07-26", { zone: 'utc' });
    if (datetimeEntered < minDate) {
      throw new Error("Date is before 2020-07-26");
    }
  } catch (error) {
    console.error("Error interpreting date. Likely not entered in format YYYY-MM-DD");
    console.error("Please try again");
    readline.close();
    process.exit(1);
  }

  const priceDaySeconds = datetimeEntered.toSeconds();
  const priceDayDateUtc = datetimeEntered.toLocaleString(DateTime.DATE_FULL);
  readline.close();

  // Hunt through blocks to find the first block on the target day
  let secondsSincePriceDay = latestTimeInSeconds - priceDaySeconds;
  let blocksAgoEstimate = Math.round(144 * secondsSincePriceDay / (60 * 60 * 24));
  let priceDayBlockEstimate = blockCount - blocksAgoEstimate;

  let blockHashB = askNode(['getblockhash', priceDayBlockEstimate]);
  let blockHeaderB = JSON.parse(askNode(['getblockheader', blockHashB, 'true']));
  let timeInSeconds = blockHeaderB.time;
  let secondsDifference = timeInSeconds - priceDaySeconds;
  let blockJumpEstimate = Math.round(144 * secondsDifference / (60 * 60 * 24));

  let lastEstimate = 0;
  let lastLastEstimate = 0;
  while (blockJumpEstimate > 6 && blockJumpEstimate !== lastLastEstimate) {
    lastLastEstimate = lastEstimate;
    lastEstimate = blockJumpEstimate;

    priceDayBlockEstimate -= blockJumpEstimate;
    blockHashB = askNode(['getblockhash', priceDayBlockEstimate]);
    blockHeaderB = JSON.parse(askNode(['getblockheader', blockHashB, 'true']));
    timeInSeconds = blockHeaderB.time;
    secondsDifference = timeInSeconds - priceDaySeconds;
    blockJumpEstimate = Math.round(144 * secondsDifference / (60 * 60 * 24));
  }

  if (timeInSeconds > priceDaySeconds) {
    while (timeInSeconds > priceDaySeconds) {
      priceDayBlockEstimate -= 1;
      blockHashB = askNode(['getblockhash', priceDayBlockEstimate]);
      blockHeaderB = JSON.parse(askNode(['getblockheader', blockHashB, 'true']));
      timeInSeconds = blockHeaderB.time;
    }
    priceDayBlockEstimate += 1;
  } else if (timeInSeconds < priceDaySeconds) {
    while (timeInSeconds < priceDaySeconds) {
      priceDayBlockEstimate += 1;
      blockHashB = askNode(['getblockhash', priceDayBlockEstimate]);
      blockHeaderB = JSON.parse(askNode(['getblockheader', blockHashB, 'true']));
      timeInSeconds = blockHeaderB.time;
    }
  }

  const priceDayBlock = priceDayBlockEstimate;

  // Build the container to hold the output amounts bell curve
  const firstBinValue = -6;
  const lastBinValue = 6;
  const rangeBinValues = lastBinValue - firstBinValue;
  const outputBellCurveBins = [0.0];

  for (let exponent = -6; exponent < 6; exponent++) {
    for (let b = 0; b < 200; b++) {
      const binValue = Math.pow(10, exponent + b / 200);
      outputBellCurveBins.push(binValue);
    }
  }

  const numberOfBins = outputBellCurveBins.length;
  const outputBellCurveBinCounts = new Array(numberOfBins).fill(0.0);

  // Get all output amounts from all blocks on target day
  console.log(`\nReading all blocks on ${priceDayDateUtc}...`);
  console.log("\nThis will take a few minutes (~144 blocks)...");
  console.log("\nHeight\tTime(utc)\t\tTime(32bit)\t\t  Completion %");

  let blockHeight = priceDayBlock;
  let blockHashB = askNode(['getblockhash', blockHeight]);
  let blockB = JSON.parse(askNode(['getblock', blockHashB, '2']));
  let timeInSeconds = blockB.time;
  let timeDateTime = DateTime.fromSeconds(timeInSeconds, { zone: 'utc' });
  let timeUtc = timeDateTime.toFormat('HH:mm:ss');
  let dayOfMonth = timeDateTime.day;
  let targetDayOfMonth = dayOfMonth;
  let time32Bit = (timeInSeconds & 0b11111111111111111111111111111111).toString(2).padStart(32, '0');

  while (targetDayOfMonth === dayOfMonth) {
    const progressEstimate = 100.0 * (timeDateTime.hour + timeDateTime.minute / 60) / 24.0;
    console.log(`${blockHeight}\t${timeUtc}\t${time32Bit}\t${progressEstimate.toFixed(2)}%`);

    for (const tx of blockB.tx) {
      for (const output of tx.vout) {
        const amount = parseFloat(output.value);
        if (amount > 1e-6 && amount < 1e6) {
          const amountLog = Math.log10(amount);
          const percentInRange = (amountLog - firstBinValue) / rangeBinValues;
          let binNumberEst = Math.floor(percentInRange * numberOfBins);
          while (outputBellCurveBins[binNumberEst] <= amount) {
            binNumberEst += 1;
          }
          const binNumber = binNumberEst - 1;
          outputBellCurveBinCounts[binNumber] += 1.0;
        }
      }
    }

    blockHeight += 1;
    blockHashB = askNode(['getblockhash', blockHeight]);
    blockB = JSON.parse(askNode(['getblock', blockHashB, '2']));
    timeInSeconds = blockB.time;
    timeDateTime = DateTime.fromSeconds(timeInSeconds, { zone: 'utc' });
    timeUtc = timeDateTime.toFormat('HH:mm:ss');
    dayOfMonth = timeDateTime.day;
    time32Bit = (timeInSeconds & 0b11111111111111111111111111111111).toString(2).padStart(32, '0');
  }

  console.log("\nNormalizing and displaying histogram...");

  // Normalize and plot the histogram
  const totalOutputs = outputBellCurveBinCounts.reduce((a, b) => a + b, 0.0);
  for (let b = 0; b < numberOfBins; b++) {
    outputBellCurveBinCounts[b] /= totalOutputs;
  }

  for (let b = 1; b < numberOfBins; b++) {
    if (outputBellCurveBinCounts[b] > 0.01) {
      console.log(`Bin ${b}: ${outputBellCurveBins[b].toFixed(8)} LTC - ${outputBellCurveBinCounts[b].toFixed(4)}`);
    }
  }
});
