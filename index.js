const commandLineArgs = require('command-line-args');
const fs = require('fs');
const fetch = require('node-fetch');
const cheerio = require('cheerio');

const optionDefinitions = [
  { name: 'year', type: Number, multiple: true },
  { name: 'make', type: String, multiple: true },
  { name: 'model', type: String, multiple: true },
  { name: 'pricelow', type: Number },
  { name: 'pricehigh', type: Number },
];

const options = commandLineArgs(optionDefinitions);

init();


/* functions */

function init() {
  const zeckSearchUrl = buildUrlFromOptions(options);

  fetch(zeckSearchUrl)
    .then(res => res.text())
    .then(parseHtmlToData)
    .then(compareNewVehicles)
    .then(saveJsonToDisk)
    .catch(e => console.log('Could not get page data! ', e));
}

function buildUrlFromOptions(options) {
  // http://www.zeckford.com/used-inventory/index.htm?year=2016&make=Ford&model=Explorer&internetPrice=20000-24999%2C25000-29999&sortBy=internetPrice+asc&

  let url = 'http://www.zeckford.com/used-inventory/index.htm?';

  if (options.year && options.year.length > 0) {
    options.year.forEach(year => {
      url += `&year=${year}`;
    });
  }

  if (options.make && options.make.length > 0) {
    options.make.forEach(make => {
      url += `&make=${make}`;
    });
  }

  if (options.model && options.model.length > 0) {
    options.model.forEach(model => {
      url += `&model=${model}`;
    });
  }

  if (options.pricehigh && options.pricehigh > 0) {
    if (!options.pricelow) {
      options.pricelow = 1;
    }

    url += `&internetPrice=${options.pricelow}-${options.pricehigh}`;
  }

  /* add sort */
  url += '&sortBy=internetPrice+asc&';

  console.log('Query URL: ', url);

  return url;
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

function saveJsonToDisk(data) {
  const json = JSON.stringify(data, null, 2);
  fs.writeFile('vehicles.json', json, 'utf8', function() {});

  return data;
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
  const protocolRelativeUrl = $veh.find('.hproduct .thumb').attr('data-src');
  return `https:${protocolRelativeUrl}`;
}

function compareNewVehicles(newVehicleData) {
  const prevFoundVehicles = JSON.parse(fs.readFileSync('vehicles.json'));

  var newVehiclesSinceLastRun = newVehicleData.filter(nv => {
    return prevFoundVehicles.filter(pv => pv.stockNum == nv.stockNum).length === 0;
  });

  newVehiclesSinceLastRun.forEach(v => {
    sendSlackNotification(v);
  });

  return newVehicleData;
}

function sendSlackNotification(v) {
  const test = {
    "attachments": [
      {
        pretext: 'New vehicle found!',
        text: '',
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
