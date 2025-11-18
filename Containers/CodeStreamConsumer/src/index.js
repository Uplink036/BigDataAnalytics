const express = require('express');
const formidable = require('formidable');
const fs = require('fs/promises');
const app = express();
const PORT = 3000;

const Timer = require('./Timer');
const CloneDetector = require('./CloneDetector');
const CloneStorage = require('./CloneStorage');
const FileStorage = require('./FileStorage');


// Express and Formidable stuff to receice a file for further processing
// --------------------
const form = formidable({multiples:false});

app.post('/', fileReceiver );
function fileReceiver(req, res, next) {
    form.parse(req, (err, fields, files) => {
        fs.readFile(files.data.filepath, { encoding: 'utf8' })
            .then( data => { return processFile(fields.name, data); });
    });
    return res.end('');
}

app.get('/', viewClones );
app.get('/time', viewTimeStatistics );

const server = app.listen(PORT, () => { console.log('Listening for files on port', PORT); });


// Page generation for viewing current progress
// --------------------
function getStatistics() {
    let cloneStore = CloneStorage.getInstance();
    let fileStore = FileStorage.getInstance();
    let output = 'Processed ' + fileStore.numberOfFiles + ' files containing ' + cloneStore.numberOfClones + ' clones.'
    return output;
}

function lastFileTimersHTML() {
    if (!lastFile) return '';
    output = '<p>Timers for last file processed:</p>\n<ul>\n'
    let timers = Timer.getTimers(lastFile);
    for (t in timers) {
        output += '<li>' + t + ': ' + (timers[t] / (1000n)) + ' µs\n'
    }
    output += '</ul>\n';
    return output;
}

function listClonesHTML() {
    let cloneStore = CloneStorage.getInstance();
    let output = '';

    cloneStore.clones.forEach( clone => {
        output += '<hr>\n';
        output += '<h2>Source File: ' + clone.sourceName + '</h2>\n';
        output += '<p>Starting at line: ' + clone.sourceStart + ' , ending at line: ' + clone.sourceEnd + '</p>\n';
        output += '<ul>';
        clone.targets.forEach( target => {
            output += '<li>Found in ' + target.name + ' starting at line ' + target.startLine + '\n';            
        });
        output += '</ul>\n'
        output += '<h3>Contents:</h3>\n<pre><code>\n';
        output += clone.originalCode;
        output += '</code></pre>\n';
    });

    return output;
}

function listProcessedFilesHTML() {
    let fs = FileStorage.getInstance();
    let output = '<HR>\n<H2>Processed Files</H2>\n'
    output += fs.filenames.reduce( (out, name) => {
        out += '<li>' + name + '\n';
        return out;
    }, '<ul>\n');
    output += '</ul>\n';
    return output;
}

function viewClones(req, res, next) {
    let page='<HTML><HEAD><TITLE>CodeStream Clone Detector</TITLE></HEAD>\n';
    page += '<BODY><H1>CodeStream Clone Detector</H1>\n';
    page += '<P>' + getStatistics() + '</P>\n';
    page += lastFileTimersHTML() + '\n';
    page += listClonesHTML() + '\n';
    page += listProcessedFilesHTML() + '\n';
    page += '</BODY></HTML>';
    res.send(page);
}

function viewTimeStatistics(req, res, next) {
    let page = '<HTML><HEAD><TITLE>Processing Time Statistics</TITLE>';
    page += '<script src="https://cdn.jsdelivr.net/npm/chart.js"></script></HEAD>\n';
    page += '<BODY><H1>Processing Time Statistics</H1>\n';
    page += '<P>' + getStatistics() + '</P>\n';
    page += generateTimeStatsHTML();
    page += generateTimeChart();
    page += generateAccumalativeTimeChart();
    page += '</BODY></HTML>';
    res.send(page);
}

function generateTimeStatsHTML() {
    if (timePerFile.length === 0) return '<p>No timing data available yet.</p>';
    
    let output = '<h2>Time Statistics</h2>\n';
    
    // Current stats
    if (lastFile) {
        let timers = Timer.getTimers(lastFile);
        output += '<h3>Last File Processed:</h3>\n<ul>\n';
        for (let t in timers) {
            output += '<li>' + t + ': ' + (timers[t] / 1000n) + ' µs</li>\n';
        }
        output += '</ul>\n';
    }
    
    // Moving averages
    output += '<h3>Moving Averages:</h3>\n';
    output += '<p>' + getMovingAverage(10) + '</p>\n';
    output += '<p>' + getMovingAverage(100) + '</p>\n';
    output += '<p>' + getMovingAverage(timePerFile.length) + '</p>\n';
    
    return output;
}

function getMovingAverage(number) {
    if (timePerFile.length === 0) return 'No data available';
    if (number > timePerFile.length) number = timePerFile.length;
    
    let avgTotalTime = BigInt(0);
    let avgMatchTime = BigInt(0);
    
    for (let i = Math.max(timePerFile.length - number, 0); i < timePerFile.length; i++) {
        avgTotalTime += timePerFile[i][0];
        avgMatchTime += timePerFile[i][1];
    }
    
    avgTotalTime = avgTotalTime / BigInt(number);
    avgMatchTime = avgMatchTime / BigInt(number);
    
    return `Last ${number} files - Total: ${avgTotalTime / 1000n} µs, Match: ${avgMatchTime / 1000n} µs`;
}

function generateTimeChart() {
    if (timePerFile.length === 0) return '';
    
    let totalTimes = timePerFile.map((time, index) => ({x: index + 1, y: Number(time[0] / 1000n)}));
    let matchTimes = timePerFile.map((time, index) => ({x: index + 1, y: Number(time[1] / 1000n)}));
    
    return `
    <h2>Processing Time Chart</h2>
    <canvas id="timeChart" width="800" height="400"></canvas>
    <script>
    const ctx = document.getElementById('timeChart').getContext('2d');
    new Chart(ctx, {
        type: 'line',
        data: {
            datasets: [{
                label: 'Total Time (µs)',
                data: ${JSON.stringify(totalTimes)},
                borderColor: 'rgb(75, 192, 192)',
                backgroundColor: 'rgba(75, 192, 192, 0.2)',
                tension: 0.1
            }, {
                label: 'Match Time (µs)',
                data: ${JSON.stringify(matchTimes)},
                borderColor: 'rgb(255, 99, 132)',
                backgroundColor: 'rgba(255, 99, 132, 0.2)',
                tension: 0.1
            }]
        },
        options: {
            responsive: true,
            scales: {
                x: {
                    type: 'linear',
                    position: 'bottom',
                    title: { display: true, text: 'File Number' }
                },
                y: {
                    title: { display: true, text: 'Time (microseconds)' }
                }
            }
        }
    });
    </script>`;
}

function generateAccumalativeTimeChart() {
    if (timePerFile.length === 0) return '';
    
    let totalTimes = [];
    const initialValue = 0n;
    for (let i = 1; i <= timePerFile.length; i++)
    {
        totalTimes.push(timePerFile.slice(0, i).reduce((accumulator, currentValue) => accumulator + currentValue[0], initialValue))
    }
    
    let labels = totalTimes.map((_, index) => index + 1);
    let chartData = totalTimes.map(time => Number(time / 1000n));
    
    return `
    <h2>Cumulative Processing Time Chart</h2>
    <canvas id="timeAccumlativeChart" width="800" height="400"></canvas>
    <script>
    const ctx2 = document.getElementById('timeAccumlativeChart').getContext('2d');
    new Chart(ctx2, {
        type: 'line',
        data: {
            labels: ${JSON.stringify(labels)},
            datasets: [{
                label: 'Cumulative Total Time (µs)',
                data: ${JSON.stringify(chartData)},
                borderColor: 'rgb(75, 192, 192)',
                backgroundColor: 'rgba(75, 192, 192, 0.2)',
                tension: 0.1
            }]
        },
        options: {
            responsive: true,
            scales: {
                x: {
                    title: { display: true, text: 'File Number' }
                },
                y: {
                    title: { display: true, text: 'Accumulative Time (microseconds)' }
                }
            }
        }
    });
    </script>`;
}

// Some helper functions
// --------------------
// PASS is used to insert functions in a Promise stream and pass on all input parameters untouched.
PASS = fn => d => {
    try {
        fn(d);
        return d;
    } catch (e) {
        throw e;
    }
};

const STATS_FREQ = 100;
const URL = process.env.URL || 'http://localhost:8080/';
var lastFile = null;
var timePerFile = []

function saveTimeStatistics(file) {
    let timers = Timer.getTimers(file);
    timePerFile.push([timers['total'], timers['match']])
    return file;
}

function maybePrintStatistics(file, cloneDetector, cloneStore) {
    if (0 == cloneDetector.numberOfProcessedFiles % STATS_FREQ) {
        console.log('Processed', cloneDetector.numberOfProcessedFiles, 'files and found', cloneStore.numberOfClones, 'clones.');
        let timers = Timer.getTimers(file);
        let last1 = 'Timers for last file processed: ';
        for (t in timers) {
            last1 += t + ': ' + (timers[t] / (1000n)) + ' µs '
        }
        console.log(last1);
        
        let last10 = movingAvg(100);
        console.log(last10);
        
        let last100 = movingAvg(10000);
        console.log(last100);

        console.log('List of found clones available at', URL);
    }

    return file;

    function movingAvg(number) {
        if (number > timePerFile.length)
            number = timePerFile.length;
            let avgTotalTime = BigInt(0);
        let avgMatchTime = BigInt(0);
        for (let fileIndex = Math.max(timePerFile.length - (number+1), 0); 
            fileIndex < timePerFile.length; 
            fileIndex++) 
        {
            const time = timePerFile[fileIndex]
            avgTotalTime += time[0];
            avgMatchTime += time[1];
        }
        avgTotalTime = avgTotalTime / BigInt(number);
        avgMatchTime = avgMatchTime / BigInt(number);
        let outputString = 'Timers for last ' + number + ' files processed: ';
        outputString +=    'total: ' + avgTotalTime / 1000n + ' µs ';
        outputString +=    'match: ' + avgTotalTime / 1000n + ' µs ';
        return outputString;
    }
}

// Processing of the file
// --------------------
function processFile(filename, contents) {
    let cd = new CloneDetector();
    let cloneStore = CloneStorage.getInstance();

    return Promise.resolve({name: filename, contents: contents} )
        //.then( PASS( (file) => console.log('Processing file:', file.name) ))
        .then( (file) => Timer.startTimer(file, 'total') )
        .then( (file) => cd.preprocess(file) )
        .then( (file) => cd.transform(file) )

        .then( (file) => Timer.startTimer(file, 'match') )
        .then( (file) => cd.matchDetect(file) )
        .then( (file) => cloneStore.storeClones(file) )
        .then( (file) => Timer.endTimer(file, 'match') )

        .then( (file) => cd.storeFile(file) )
        .then( (file) => Timer.endTimer(file, 'total') )
        .then( PASS( (file) => lastFile = file ))
        .then( PASS( (file) => saveTimeStatistics(file)))
        .then( PASS( (file) => maybePrintStatistics(file, cd, cloneStore) ))
    // TODO Store the timers from every file (or every 10th file), create a new landing page /timers
    // and display more in depth statistics there. Examples include:
    // average times per file, average times per last 100 files, last 1000 files.
    // Perhaps throw in a graph over all files.
        .catch( console.log );
};

/*
1. Preprocessing: Remove uninteresting code, determine source and comparison units/granularities
2. Transformation: One or more extraction and/or transformation techniques are applied to the preprocessed code to obtain an intermediate representation of the code.
3. Match Detection: Transformed units (and/or metrics for those units) are compared to find similar source units.
4. Formatting: Locations of identified clones in the transformed units are mapped to the original code base by file location and line number.
5. Post-Processing and Filtering: Visualisation of clones and manual analysis to filter out false positives
6. Aggregation: Clone pairs are aggregated to form clone classes or families, in order to reduce the amount of data and facilitate analysis.
*/
