const commandLineArgs = require('command-line-args');
const fs = require('fs');
const fetch = require('node-fetch');
const cheerio = require('cheerio');

const optionDefinitions = [
  { name: 'year', type: Number, multiple: true },
  { name: 'make', type: String },
  { name: 'model', type: String },
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

  if (options.make) {
    url += `&make=${options.make}`;
  }

  if (options.model) {
    url += `&model=${options.model}`;
  }

  if (options.pricehigh && options.pricehigh > 0) {
    if (!options.pricelow) {
      options.pricelow = 1;
    }

    url += `&internetPrice=${options.pricelow}-${options.pricehigh}`;
  }

  /* add sort */
  url += '&sortBy=internetPrice+asc&';

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
      stockNum: findVehStockNum($veh),
      price: findVehPrice($veh),
      mileage: findVehMileage($veh),
      year: findVehHProductData($veh, 'data-year'),
      make: findVehHProductData($veh, 'data-year'),
      model: findVehHProductData($veh, 'data-model'),
      trim: findVehHProductData($veh, 'data-trim'),
      bodyStyle: findVehHProductData($veh, 'data-bodystyle'),
      engine: findVehDescriptionData($veh, 0),
      transmission: findVehDescriptionData($veh, 1),
      extColor: findVehDescriptionData($veh, 2),
      intColor: findVehDescriptionData($veh, 3),
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
}

function findVehStockNum($veh) {
  return $veh.find('dl.last').children('dd').first().text();
}

function findVehMileage($veh) {
  return $veh.find('dl.last').children('dd').last().text();
}

function findVehPrice($veh) {
  return $veh.find('.internetPrice.final-price .value').text();
}

function findVehHProductData($veh, attr) {
  return $veh.find('.hproduct').attr(attr);
}

function findVehDescriptionData($veh, index) {
  const $dl = $veh.find('.description > dl').first();
  const $dd = $dl.find('dd').slice(index).eq(0);
  $dd.find('span').text('');
  return $dd.text();
}

function findVehDetailLink($veh) {
  const relPath = $veh.find('.media > a').attr('href');
  return `http://www.zeckford.com${relPath}`;
}

function findVehImg($veh) {
  const protocolRelativeUrl = $veh.find('.media > a > img').attr('src');
  return `https:${protocolRelativeUrl}`;
}
