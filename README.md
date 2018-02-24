<!-- README template from
https://raw.githubusercontent.com/dbader/readme-template/master/README.md
-->

# gstore cache

> Cache Manager for Google Datastore

[![NPM Version][npm-image]][npm-url]
[![Build Status][travis-image]][travis-url]
[![coveralls-image]][coveralls-url]

gstore cache helps you speed up your Datastore entities fetching by providing an advanced cache layer on top of @google-cloud/datastore:

* Define multiple cache stores with different TTL thanks to [node-cache-manager](https://github.com/BryanDonovan/node-cache-manager).
* LRU memory cache out of the box to speed up your application right away!
* Datastore Key and Query objects are converted to **unique string ids** easy to cache
* Advanced cache (when using [node Redis](https://github.com/NodeRedis/node_redis)) that automatically saves your Queries in Redis "Sets" by **Entity Kind**. You can then set an infinite TTL (time to live) for your queries and only invalidate the cache when you either _edit_ or _delete_ an entity Kind.

## Installation

```sh
npm install gstore-cache --save
# or
yarn add gstore-cache
```

## Usage example

### Datastore Keys

```js
const Datastore = require('@google-cloud/datastore');
const gstoreCache = require('gstore-cache');

const datastore = new Datastore();
const cache = gstoreCache.init({ datastore });

const key = datastore.key(['Company', 'Google']);

/**
 * The "keys.wrap()" helper will
 * - Look for the entity in the cache
 * - If not found, fetch it from the Datastore
 * - Prime the cache with the entity fetched from the Datastore.
 */
cache.keys.wrap(key).then(entity => {
    console.log(entity);
    console.log(entity[datastore.KEY]); // the Key Symbol is added from cache results
});

/**
 * You can also pass several keys.
 * gstore-cache will first check the cache and only fetch from the Datastore
 * the keys that were *not* found in the cache.
 *
 * In the example below, only the "key3" would be passed to datastore.get() and
 * fetched from the Datastore
 */
const key1 = datastore.key(['Task', 123]); // this entity is in cache
const key2 = datastore.key(['Task', 456]); // this entity is in cache
const key3 = datastore.key(['Task', 789]);

cache.keys.wrap([key1, key2, key3]).then(entities => {
    console.log(entities[0]);
    console.log(entities[1]);
    console.log(entities[2]);
});
```

The "wrap" helper above is just syntactic sugar for the following

```js
const Datastore = require('@google-cloud/datastore');
const gstoreCache = require('gstore-cache');

// After you initialized the cache (once at app bootstrap), this is how you get its instance
const cache = gstoreCache.instance();

const datastore = new Datastore();
const key = datastore.key(['Company', 'Google']);

cache.keys
    .get(key)
    .then(cacheEntity => {
        if (cacheEntity) {
            // Cache found... great!
            return cacheEntity;
        }

        // Fetch from the Datastore
        return datastore.get(key).then(response => {
            const entity = response[0];

            // Prime the cache.
            // The Datastore Key object will be converted to a unique
            // string key in the cache.
            return cache.keys.set(key, entity);
        });
    })
    .then(entity => {
        console.log(entity);
    });
```

### Datastore Queries

```js
const Datastore = require('@google-cloud/datastore');
const gstoreCache = require('gstore-cache');

const datastore = new Datastore();
const cache = gstoreCache.init({ datastore });

const query = datastore
    .createQuery('Post')
    .filter('category', 'tech')
    .order('updatedOn')
    .limit(10);

/**
 * Just like with the Keys, the "queries.wrap()" helper will
 * - Look for the query in the cache
 * - If not found, run the query on the Datastore
 * - Prime the cache with the response of the query.
 */
cache.queries.wrap(query).then(response => {
    const [entities, meta] = response;

    console.log(entities);
    console.log(entities[0][datastore.KEY]); // KEY Symbol are saved in Cache too
    console.log(meta.moreResults);
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

To run the e2e test you need to launch the Local Datastore emulator and a local Redis server.

```sh
# Local Datastore
# Make sure you have the emulator installed
# More info: https://cloud.google.com/datastore/docs/tools/datastore-emulator
#
# The following command will create a "local-datastore" folder inside the project
# where the Local Datastore will keep the entities
gcloud beta emulators datastore start --data-dir=$PWD/local-datastore

# Redis server (Mac Os or Linux)
# From inside the folder where redis is located:
./redis-server
```

## Release History

* 0.1.0
    * First Release

## Meta

Sébastien Loix – [@sebloix](https://twitter.com/sebloix) – sebastien@loix.me

Distributed under the MIT license. See `LICENSE` for more information.

[https://github.com/sebelga](https://github.com/sebelga/)  
[http://s.loix.me](http://s.loix.me)

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
