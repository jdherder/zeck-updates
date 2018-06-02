'use strict';

/* USAGE: node index.js --make Ford --model F-150 --year 2015 --year 2016 --year 2017 --year 2018 --year 2019 --pricehigh 38000 --search SuperCrew --testing true */

const commandLineArgs = require('command-line-args');
const fs = require('fs');
const path = require('path');
const fetch = require('node-fetch');
const cheerio = require('cheerio');

const optionDefinitions = [
  { name: 'testing', type: Boolean },
  { name: 'year', type: Number, multiple: true },
  { name: 'make', type: String, multiple: true },
  { name: 'model', type: String, multiple: true },
  { name: 'pricelow', type: Number },
  { name: 'pricehigh', type: Number },
  { name: 'search', type: String },
];

const options = commandLineArgs(optionDefinitions);

init();


/* functions */

function init() {
  // const urls = buildUrlsFromOptions(options);
  // const promises = urls.map((urlData, i) => getPageData(urlData, i));

  getNonce()
    .then(nonce => buildUrlsFromOptions(options, nonce).map(urlData => getPageData(urlData)))
    .then(pageDataPromises => Promise.all(pageDataPromises))
    .then(pageDataResults => pageDataResults.reduce((sum, value) => sum.concat(value || []), []))
    .then(compareNewVehicles)
    .then(saveJsonToDisk)
    .catch(e => console.log('Could not get page data! ', e));

  // Promise
  //   .all(promises)
  //   .then(results => results.reduce((sum, value) => sum.concat(value || []), []))
  //   .then(compareNewVehicles)
  //   .then(saveJsonToDisk)
  //   .catch(e => console.log('Could not get page data! ', e));
}

function getNonce() {
  return fetch('https://www.zeckford.com/', {
    method: 'GET',
    cache: 'no-cache',
    credentials: 'include',
    referrer: 'no-referrer',
  })
  .then(response => response.text())
  .then((page) => {
    const nonce = page.match(/\"ajax_nonce\"\:\"(.*?)\"\,\"/)[1];
    
    return nonce;
  });
}

function getPageData(urlData) {
  console.log('getpagedata', urlData);
  return fetch(urlData.host, {
    body: urlData.params,
    headers: {
      'content-type': 'application/x-www-form-urlencoded',
    },
    credentials: 'include',
    cache: 'no-cache',
    method: 'POST',
  })
  .then(response => response.json())
  .then(data => data.results)
  .then(parseHtmlToData);
}

function buildUrlsFromOptions(options, nonce) {
  // https://www.zeckford.com/new-vehicles/#action=im_ajax_call&perform=get_results&our_price%5B%5D=0-40000&page=1&order=DESC&orderby=price&type%5B%5D=New&type%5B%5D=Used&model%5B%5D=F-150&year%5B%5D=2018&year%5B%5D=2017&year%5B%5D=2016&year%5B%5D=2015

  let params = `action=im_ajax_call&perform=get_results&_nonce=${nonce}&_post_id=6&_referer=/used-vehicles/`;

  params += `&type%5B%5D=New&type%5B%5D=Used&type%5B%5D=Certified+Used`;

  if (options.year && options.year.length > 0) {
    options.year.forEach(year => {
      params += `&year%5B%5D=${year}`;
    });
  }

  if (options.make && options.make.length > 0) {
    options.make.forEach(make => {
      params += `&make%5B%5D=${make}`;
    });
  }

  if (options.model && options.model.length > 0) {
    options.model.forEach(model => {
      params += `&model%5B%5D=${model}`;
    });
  }

  if (options.pricehigh && options.pricehigh > 0) {
    if (!options.pricelow) {
      options.pricelow = 1;
    }

    params += `&our_price%5B%5D=${options.pricelow}-${options.pricehigh}`;
  }

  if (options.search) {
    params += `&search=${encodeURI(options.search)}`;
  }

  const host = 'https://www.zeckford.com/';

  // TODO: The site will force pagination on a query. Currently this is an arbitrary number of pages to hopefully get all results, ideally we would find out how many pages the result set has and make only that many requests.
  const urlData = [1, 2, 3, 4, 5, 6].map((pageNum) => {
    return {
      host: host,
      params: params + `&page=${pageNum}`,
    }
  });

  return urlData;
}

function parseHtmlToData(markup) {
  console.log('markup', markup);
  const $ = cheerio.load(markup);
  const vehicles = [];
  const $vehArr = [];

  // Note: Intentional use of function() here, otherwise $(this) context does not work as expected.
  $('.vehicle').each(function() {
    $vehArr.push($(this));
  });

  $vehArr.forEach($veh => {

    // If not even a year is present, early return and do not add to vehicles array.
    if (!$veh.data('year')) {
      return;
    }

    const vehicle = {
      stockNum: $veh.data('stock'),
      price: $veh.find('.save-things-save').data('amount'),
      mileage: $veh.data('mileage'),
      year: $veh.data('year'),
      make: $veh.data('make'),
      model: $veh.data('model'),
      trim: $veh.data('trim'),
      bodyStyle: $veh.data('body'),
      engine: $veh.data('engine'),
      transmission: $veh.data('transmission'),
      extColor: $veh.data('ext-color'),
      intColor: $veh.data('int-color'),
      vin: $veh.find('.save-things-save').data('remote-id'),
      type: $veh.data('type'),
      url: $veh.find('.save-things-save').data('url'),
      image: $veh.find('.save-things-save').data('thumbnail-url'),
    };

    console.log('pushing vehicle', vehicle.stockNum);
    vehicles.push(vehicle);
  });

  return new Promise((resolve, reject) => {
    resolve(vehicles);
  });
}

function compareNewVehicles(newVehicleData) {
  let prevFoundVehicles = {};

  try {
    prevFoundVehicles = JSON.parse(fs.readFileSync(path.join(__dirname, 'vehicles.json')));
  } catch(e) {
    console.error('Could not load vehicles.json', e);
  }

  // If new vehicle key (stock #) is found in prev vehicle list, filter it out.
  const newVehiclesSinceLastRun = newVehicleData
    .filter(newVeh => {
      return !prevFoundVehicles[newVeh.stockNum];
    });

  if (!options.testing) {
    newVehiclesSinceLastRun.forEach(v => {
      sendSlackNotification(v);
    });
  } else {
    console.log('Testing mode: Skipping notification.');
  }

  return {
    newVehArr: newVehiclesSinceLastRun,
    prevVehObj: prevFoundVehicles,
  };
}

function saveJsonToDisk(data) {
  let newFoundVehiclesObj = {};

  data.newVehArr.forEach(veh => {
    newFoundVehiclesObj[veh.stockNum] = veh;
  });

  const vehicles = Object.assign({}, newFoundVehiclesObj, data.prevVehObj);
  const json = JSON.stringify(vehicles, null, 2);

  fs.writeFile(path.join(__dirname, 'vehicles.json'), json, 'utf8', function() {});

  return vehicles;
}

function sendSlackNotification(v) {
  const test = {
    "attachments": [
      {
        fallback: `A new ${v.year} ${v.make} ${v.model} found!`,
        pretext: '',
        text: 'New vehicle found!',
        title: `${v.year} ${v.make} ${v.model} ${v.trim} - ${v.stockNum}`,
        title_link: v.url,
        fields: [
          {
            title: 'Price',
            value: v.price
          },
          {
            title: 'Mileage',
            value: v.mileage
          },
          {
            title: 'Engine',
            value: v.engine
          },
          {
            title: 'Transmission',
            value: v.transmission
          },
          {
            title: 'Exterior',
            value: v.extColor
          },
          {
            title: 'Interior',
            value: v.intColor
          }
        ],
        image_url: v.image,
      }
    ]
  };

  fetch('https://hooks.slack.com/services/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',
    {
      method: 'POST',
      body: JSON.stringify(test),
      headers: {
        'Content-type': 'application/json',
      },
    })
    .catch(error => {
      console.log('Could not post to Slack', error);
    });
}
