'use strict';

/* Sample run command: node index.js --make Ford --model F-150 --pricehigh 35000 */

const commandLineArgs = require('command-line-args');
const fs = require('fs');
const path = require('path');
const fetch = require('node-fetch');
const cheerio = require('cheerio');

const optionDefinitions = [
  { name: 'year', type: Number, multiple: true },
  { name: 'make', type: String, multiple: true },
  { name: 'model', type: String, multiple: true },
  { name: 'style', type: String, multiple: true },
  { name: 'pricelow', type: Number },
  { name: 'pricehigh', type: Number },
];

init(commandLineArgs(optionDefinitions));


/* functions */

function init(options) {
  const urls = buildUrlsFromOptions(options);
  const promises = urls.map(getPageData);

  Promise
    .all(promises)
    .then(results => results.reduce((sum, value) => sum.concat(value || []), []))
    .then(compareNewVehicles)
    .then(saveJsonToDisk)
    .catch(e => console.log('Could not get page data! ', e));
}

function getPageData(url) {
  return fetch(url)
    .then(res => res.text())
    .then(parseHtmlToData);
}

function buildUrlsFromOptions(options) {
  // http://www.zeckford.com/used-inventory/index.htm?year=2016&make=Ford&model=Explorer&internetPrice=20000-24999%2C25000-29999&sortBy=internetPrice+asc&

  // http://www.zeckford.com/new-inventory/index.htm?model=F-150&bodyStyle=SuperCrew&internetPrice=0-44999

  let params = '';

  if (options.year && options.year.length > 0) {
    options.year.forEach(year => {
      params += `&year=${year}`;
    });
  }

  if (options.make && options.make.length > 0) {
    options.make.forEach(make => {
      params += `&make=${make}`;
    });
  }

  if (options.model && options.model.length > 0) {
    options.model.forEach(model => {
      params += `&model=${model}`;
    });
  }

  if (options.style && options.style.length > 0) {
    options.style.forEach(style => {
      params += `&bodyStyle=${style}`;
    });
  }

  if (options.pricehigh && options.pricehigh > 0) {
    if (!options.pricelow) {
      options.pricelow = 1;
    }

    params += `&internetPrice=${options.pricelow}-${options.pricehigh}`;
  }

  const urls = [
    'http://www.zeckford.com/new-inventory/index.htm?' + params,
    'http://www.zeckford.com/used-inventory/index.htm?' + params,
  ];

  console.log('Query URL (new): ', urls[0]);
  console.log('Query URL (used): ', urls[1]);

  return urls;
}

function parseHtmlToData(markup) {
  const $ = cheerio.load(markup);
  const vehicles = [];
  const $vehArr = [];

  $('.inventoryList .item').each(function() {
    $vehArr.push($(this));
  });

  $vehArr.forEach($veh => {
    const vehicle = {
      stockNum: findVehDescriptionData($veh, 'Stock #'),
      price: findVehPrice($veh),
      mileage: findVehDescriptionData($veh, 'Mileage'),
      year: findVehHProductData($veh, 'data-year'),
      make: findVehHProductData($veh, 'data-make'),
      model: findVehHProductData($veh, 'data-model'),
      trim: findVehHProductData($veh, 'data-trim'),
      bodyStyle: findVehHProductData($veh, 'data-bodystyle'),
      engine: findVehDescriptionData($veh, 'Engine'),
      transmission: findVehDescriptionData($veh, 'Transmission'),
      extColor: findVehDescriptionData($veh, 'Exterior Color'),
      intColor: findVehDescriptionData($veh, 'Interior Color'),
      vin: findVehHProductData($veh, 'data-vin'),
      type: findVehHProductData($veh, 'data-type'),
      url: findVehDetailLink($veh),
      image: findVehImg($veh),
    };

    vehicles.push(vehicle);
  });

  return new Promise((resolve, reject) => {
    resolve(vehicles);
  });
}

/**
 * Use regex to pull data between given attr string and terminating string.
 * @param $veh
 * @param attr
 * @returns {string}
 */
function findVehDescriptionData($veh, attr) {
  const descriptionData = $veh.find('.description').text();
  const exp = `${attr}: (.*?)(,| More)`;
  const regex = new RegExp(exp);
  const match = descriptionData.match(regex);

  if (match) {
    return match[1];
  }

  return '';
}

function findVehPrice($veh) {
  return $veh.find('.internetPrice.final-price .value').text();
}

function findVehHProductData($veh, attr) {
  return $veh.find('.hproduct').attr(attr);
}

function findVehDetailLink($veh) {
  const relPath = $veh.find('.media > a').attr('href');
  return `http://www.zeckford.com${relPath}`;
}

function findVehImg($veh) {
  const $vehThumb = $veh.find('.hproduct .thumb');
  const protocolRelativeUrl = $vehThumb.attr('data-src') || $vehThumb.attr('src');

  return `https:${protocolRelativeUrl}`;
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

  newVehiclesSinceLastRun.forEach(v => {
    sendSlackNotification(v);
  });

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
