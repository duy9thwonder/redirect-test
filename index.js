#!/usr/bin/env node

const path = require('path');
const fs = require('fs');
const URL = require('url');
const csv = require('csv');
const request = require('request');
const _ = require('underscore');
const chalk = require('chalk');
const async = require('async');
const writeCSV = require('write-csv');
const isAbsoluteUrl = require('is-absolute-url');
const ora = require('ora');
const program = require('commander');
const pkgVersion = require('./package.json').version;

let fileName;
let siteUrl;
const options = {
  method: 'get',
  headers: {
    'User-Agent': `Redirect Tester v${pkgVersion}`,
  },
  followRedirect: true
}
const errorCodes = /4[0-9][0-3|5-9]|5[0-9][0-9]/g;
const updatedCSV = [];
var isError = false;
const error = chalk.bold.red;
const good = chalk.bold.green;
const concurrency = program.number || 5;
const spinner = ora({ spinner: 'dots2', text: `Making HTTP(S) requests with concurrency ${concurrency}` });

const q = async.queue((urls, cb) => {
  let update;
  options.url = siteUrl + urls[0];
  
  
  request(options, (err, res) => {
    if (err) {
      cb(`Error: ${err}`, null);
    } else {
      if (res.statusCode === 301) {
        const locPath = URL.parse(res.headers.location).pathname;
        if (locPath !== urls[1]) {
          update = {
            old: urls[0],
            new: urls[1],
            status_code: res.statusCode,
            actual_url: locPath,
          };
        }
      } else {
        var actualURL = URL.parse(res.request.href).pathname;
        var logString = '';
        if(urls[1] == actualURL){
          logString = 'GOOD ### '+ urls[0]+' => '+actualURL;
        }else{
          isError = true;
          logString = 'FAIL ### '+ siteUrl+urls[0]+' != '+urls[1]+' ('+res.statusCode+')';
        }
        
        var shortRedirectStr = parseRedirectObj(res.request._redirect.redirects,siteUrl);
        logString += ' \nCHAINS: '+urls[0]+' '+shortRedirectStr;
        
        
        console.log(logString);
        update = {
          status:(urls[1] == actualURL)?'GOOD':'FAIL',
          old: urls[0],
          new: urls[1],
          status_code: res.statusCode,
          actual_url: actualURL,
          redirects:shortRedirectStr
        };
      }
      if (update) {
        updatedCSV.push(update);
      }
      if (res.statusCode.toString().match(errorCodes)) {
        cb(`Error: Server returned a ${res.statusCode} status code.`, null);
      } else {
        cb(null, res);
      }
    } 
  });
}, concurrency);

q.error = (err) => {
  spinner.fail(error(err));
  q.kill();
};

q.drain = () => {
  
  if (_.isEmpty(updatedCSV) && !program.quiet) {
    spinner.succeed(good('All links look good.'));
    spinner.succeed(good('No errors so nothing written to the csv file'));
  } else if (!program.quiet) {
    spinner.fail(error('See errors in the csv file'));
    writeCSV(program.csv, updatedCSV);
  } else if (program.quiet) {
    spinner.stop();
    writeCSV(program.csv, updatedCSV);
  }
  if(isError){
    console.log('Found some fail test cases');
    setTimeout(function () {
      process.exit(1);
    }, 2000); 
    
  }
};

function parseCsv(contents) {
  csv.parse(contents, (err, data) => {
    if (err) {
      console.error(error('Error: It looks like your file is either not a csv or has some bad formatting.'));
      program.help();
    } else {
      q.push(data);
      spinner.start();
    }
  });
}

function readFile(file) {
  fs.readFile(file, 'utf8', (err, contents) => {
    if (err) {
      console.error(error(err[0]));
    } else {
      parseCsv(contents);
    }
  });
}

function parseRedirectObj(redirectObj,replaceURL){
  var returnString = '';
  redirectObj.forEach(element => {
    // console.log(element);
    returnString+=' -> '+element.redirectUri.replace(replaceURL,'');
  });
  return returnString;
}

program
  .version(pkgVersion)
  .usage('<file> <url> [options]')
  .description('Check a list of new URLs for 301 status code and path for correctness.')
  .option('-c, --csv <file>', 'Save the results to a csv file. Default: ./results.csv')
  .option('-q, --quiet', 'Don\'t output error results to the terminal.')
  .option('-n, --number <integer>', 'Number of concurrent requests. Default: 5')
  .option('-a, --auth <username:password>', 'The username and password for basic auth.')
  .arguments('<file> <url>')
  .action((file, url) => {
    fileName = path.resolve(file.trim());
    siteUrl = url.trim();
  });

program.parse(process.argv);

if (!isAbsoluteUrl(siteUrl)) {
  console.error((error('Error: URL must be an absolute path. eg. https://www.example.com')));
  program.help();
} else if (!fs.existsSync(fileName)) {
  console.error((error('Error: File or directory doesn\'t exist.')));
  program.help();
} else {
  readFile(fileName);
}

program.csv = program.csv || './results.csv';

program.csv = path.resolve(program.csv.trim());

if (program.auth) {
  const authString = program.auth.split(':');
  options.auth = {};
  options.auth.user = authString[0];
  options.auth.pass = authString[1];
}
