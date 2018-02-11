<!-- README template from
https://raw.githubusercontent.com/dbader/readme-template/master/README.md
-->

# gstore cache

> Cache Manager for Google Datastore

[![NPM Version][npm-image]][npm-url]
[![Build Status][travis-image]][travis-url]
[![coveralls-image]][coveralls-url]

Advanced cache layer for Google Datastore Datastore Entities Keys and Queries. Define multiple cache stores thanks to [node-cache-manager](https://github.com/BryanDonovan/node-cache-manager) that gstore-cache uses underneath. You get out of the box a LRU memory cache to speed up your application right away!

Advanced cache (with [node Redis](https://github.com/NodeRedis/node_redis)) will automatically save your Queries by **Entity Kind**. You can then set an infinite ttl (time to live) for your queries and only invalidate the cache when you _edit_ or _delete_ an entity Kind.

## Installation

```sh
npm install gstore-cache --save
# or
yarn add gstore-cache
```

## Usage example

```js
const Datastore = require('@google-cloud/datastore');
const GstoreCache = require('gstore-cache');

const datastore = new Datastore();
const cache = GstoreCache(); // default config (see below)

const key = datastore.key(['Company', 'Google']);

cache.keys
    .get(key)
    .then(cacheEntity => {
        if (cacheEntity) {
            // Cache found, no need to go any further
            return [cacheEntity]; // wrap in an Array to align with google-cloud response
        }

        // Fetch from the Datastore
        return datastore.get(key).then(response => {
            // prime the cache. The Datastore Key object will be converted
            // to a unique *string* key
            return cache.keys.set(key, response[0]).then(() => response);
        });
    })
    .then(response => {
        console.log(response[0]);
    });
```

The above code could be simplified with the "wrap" helper.

```js
const Datastore = require('@google-cloud/datastore');
const GstoreCache = require('gstore-cache');

const ds = new Datastore();
const cache = GstoreCache();

const key = datastore.key(['Company', 'Google']);

/**
 * "datastore.get" is the Handler to fetch the key(s) if they are not found
 */
cache.wrap(key, datastore.get).then(response => {
    console.log(response[0]);
});

/**
 * If we pass several keys, gstore-cache will first search for them in the cache.
 * If not all the keys are found, *only* the ones missing will be passed to the fetch Handler
 * In the following example, only the "key3" would be passed to datastore.get() method
 */
const key1 = datastore.key(['Task', 123]); // in cache
const key2 = datastore.key(['Task', 456]); // in cache
const key3 = datastore.key(['Task', 789]);

cache.keys.wrap([key1, key2, key3], datastore.get).then(response => {
    const entities = response[0];
    console.log(entities[0]);
    console.log(entities[1]);
    console.log(entities[2]);
});
```

## Development setup

Install the dependencies and run the tests. gstore-caches lints the code with [eslint](https://eslint.org/) and formats it with [prettier](https://prettier.io/) so make sure you have both pluggins installed in your IDE.

```sh
# Run the tests
npm install
npm test

# Coverage
npm run coverage

# Format the code (if you don't use the IDE pluggin)
npm run prettier
```

## Release History

* 0.1.0
    * First Release

## Meta

Sébastien Loix – [@sebelga](https://twitter.com/sebelga) – sebastien@loix.me

Distributed under the MIT license. See `LICENSE` for more information.

[https://github.com/sebelga](https://github.com/sebelga/)

## Contributing

1. Fork it (<https://github.com/sebelga/gstore-cache/fork>)
2. Create your feature branch (`git checkout -b feature/fooBar`)
3. Commit your changes (`git commit -am 'Add some fooBar'`)
4. Push to the branch (`git push origin feature/fooBar`)
5. Rebase your feature branch and squash (`git rebase -i master`)
6. Create a new Pull Request

<!-- Markdown link & img dfn's -->

[npm-image]: https://img.shields.io/npm/v/gstore-cache.svg?style=flat-square
[npm-url]: https://npmjs.org/package/gstore-cache
[travis-image]: https://img.shields.io/travis/sebelga/gstore-cache/master.svg?style=flat-square
[travis-url]: https://travis-ci.org/sebelga/gstore-cache
[coveralls-image]: https://img.shields.io/coveralls/github/sebelga/gstore-cache.svg
[coveralls-url]: https://coveralls.io/github/sebelga/gstore-cache?branch=master
