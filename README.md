<!-- README template from
https://raw.githubusercontent.com/dbader/readme-template/master/README.md
-->

# gstore cache

> Advanced Cache Manager for the Google Datastore

[![NPM Version][npm-image]][npm-url]
[![Build Status][travis-image]][travis-url]
[![coveralls-image]][coveralls-url]

<img title="logo" src="logo/logo.gif" width="85%" align="center">

gstore cache speeds up your Datastore entities fetching by providing an advanced cache layer  
for the [@google-cloud/datastore](https://cloud.google.com/nodejs/docs/reference/datastore/1.3.x/) _Key(s)_ and _Query_ API.

* Define **multiple cache stores** with different TTL thanks to [node-cache-manager](https://github.com/BryanDonovan/node-cache-manager).
* **LRU memory cache** out of the box to speed up your application right away.
* Datastore <Key> and <Query> objects are converted to **unique string ids** easy to cache.
* Advanced cache (when using [node_redis](https://github.com/NodeRedis/node_redis)) that automatically saves your queries in Redis "Sets" by **Entity Kind**. You can then set an **infinite TTL** (time to live) for your queries and only invalidate the cache when you _add_, _edit_ or _delete_ an entity Kind.

## Installation

```sh
npm install gstore-cache --save
# or
yarn add gstore-cache
```

## Usage example

### Datastore \<Key\>

```js
const Datastore = require('@google-cloud/datastore');
const gstoreCache = require('gstore-cache');

const datastore = new Datastore();
const cache = gstoreCache.init({ datastore });

const key = datastore.key(['Company', 'Google']);

/**
 * The "keys.read()" helper will
 * - Look for the entity in the cache
 * - If not found, fetch it from the Datastore
 * - Prime the cache with the entity fetched from the Datastore.
 */
cache.keys.read(key).then(entity => {
    console.log(entity);
    console.log(entity[datastore.KEY]); // the Key Symbol is added to the cached results
});

/**
 * You can also pass several keys.
 * gstore-cache will first check the cache and only fetch from the Datastore
 * the keys that were *not* found in the cache.
 *
 * In the example below, only the "key3" would be passed to datastore.get() and
 * fetched from the Datastore
 */
const key1 = datastore.key(['Task', 123]); // this entity is in the cache
const key2 = datastore.key(['Task', 456]); // this entity is in the cache
const key3 = datastore.key(['Task', 789]);

cache.keys.read([key1, key2, key3]).then(entities => {
    console.log(entities[0]);
    console.log(entities[1]);
    console.log(entities[2]);
});
```

The "gstoreInstance.keys.**read()**" helper above is syntactic sugar for the following:

```js
const Datastore = require('@google-cloud/datastore');
const gstoreCache = require('gstore-cache');

/**
 * After you initialized the cache (once during application bootstrap)
 * you can get its instance anywhere calling "instance()".
 */
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

### Datastore \<Query\>

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
 * Just like with the Keys, the "queries.read()" helper will
 * - Look for the query in the cache
 * - If not found, run the query on the Datastore
 * - Prime the cache with the response from the query.
 */
cache.queries.read(query).then(response => {
    const [entities, meta] = response;

    console.log(entities);
    console.log(entities[0][datastore.KEY]); // KEY Symbol are saved in cache
    console.log(meta.moreResults);
});
```

The "gstoreInstance.queries.**read()**" helper is syntactic sugar for the following:

```js
const Datastore = require('@google-cloud/datastore');
const gstoreCache = require('gstore-cache');

const datastore = new Datastore();
const cache = gstoreCache.instance();

const query = datastore
    .createQuery('Post')
    .filter('category', 'tech')
    .order('updatedOn')
    .limit(10);

cache.queries
    .get(query)
    .then(cacheResponse => {
        if (cacheResponse) {
            // Cache found... great!
            return cacheResponse;
        }

        // Run the query on the Datastore
        return query.run().then(fetchResponse => {
            // Prime the cache.
            // The Datastore Query object will be converted to a unique
            // string key in the cache.
            return cache.queries.set(query, fetchResponse);
        });
    })
    .then(response => {
        const [entities, meta] = response;
        console.log(entities);
    });
```

### Advanced Queries Caching

gstore cache has an **advanced cache mechanism** for the queries when you provide a Redis client.  

If you provide a Redis store then when you _read()_ or _set()_ a query, gstore cache not only saves the response of the query in the cache(s), but it also detects the Entity _Kind_ of the query and saves a **reference** of the query in a Redis _Set_.  
This means that you can safely have the query data in the cache infinitely until you either _add_, _edit_ or _delete_ an entity of the same _Kind_.

```js
// server.js

const Datastore = require('@google-cloud/datastore');
const gstoreCache = require('gstore-cache');
const redisStore = require('cache-manager-redis-store');

const datastore = new Datastore();

const cache = gstoreCache.init({
    datastore,
    config: {
        stores: [{ store: redisStore }],
    },
});

// ...
```

```js
// ...some handler

const query = datastore
    .createQuery('Post')
    .limit(10);

// with read()
cache.queries.read(query)
    .then((response) => {
        ...
    });

// or with set()
query.run()
    .then((response) => {
        cache.queries.set(query, response)
            .then(...);
    });

// You can now invalidate the cache only when
// you create/edit or delete a "Posts" entity.

const key = datastore.key(['Posts']);
const data = { title: 'My Post' };

datastore.save({ key, data })
    .then(() => {
        // invalidate all the queries for "Posts" Entity Kind
        cache.queries.clearQueriesEntityKind(['Posts'])
            .then(() => {
                // No more cache for Posts queries
            });
    });
```

---

## API

### gstoreCache

#### `gstoreCache.init(options)`

Initialize gstore cache. You only needs to do it once, on application bootstrap.

* _options_: An object with the following properties:

    * **datastore**: a @google-cloud/datastore instance
    * **config**: an object of configuration (optional)

The **config** object has the following properties:

* _stores_: An array of "cache-manager" stores. Each store is an object that will be passed to the `cacheManager.caching()` method. [Read the docs](https://github.com/BryanDonovan/node-cache-manager) to learn more about _node cache manager_.  

  **Important:** Since version 2.7.0 "cache-manager" allows you to set, get and delete **multiple keys** (with mset, mget and del). The store(s) you provide here must support this feature.  
  At the time of this writting only the "memory" store and the "[node-cache-manager-redis-store](https://github.com/dabroek/node-cache-manager-redis-store)" support it. If you provide a store that does not support mset/mget you can still use gstore-cache but you won't be able to set or retrieve multiple keys/queries at once.

```js
// Multi stores example

const Datastore = require('@google-cloud/datastore');
const gstoreCache = require('gstore-cache');
const redisStore = require('cache-manager-redis-store');

const datastore = new Datastore();

gstoreCache.init({
    datastore,
    config: {
        stores: [{ store: 'memory', max: 100 }, { store: redisStore }],
    },
});
```

* _ttl_: An object of TTL configuration for Keys and Queries. This is where you define the TTL (Time To Live) in **seconds** for the _Key_ caching and _Query_ caching. You can override this value on any read/set/mset call later.

```js
const config = {
    // ...
    ttl: {
        keys: 600, // 10 minutes
        queries: 5, // 5 seconds
    },
};
```

In case you have **multiple** stores, you can have a different TTL value for each store.

```js
const config = {
    // ...
    ttl: {
        stores: {
            memory: {
                keys: 300, // 5 minutes
                queries: 5,
            },
            redis: {
                keys: 60 * 60 * 24, // 1 day
                queries: 0, // infinite
            },
        },
    },
};
```

* _cachePrefix_: An object of configuration for naming the cache keys. Each cache key will be prepended with a prefix that you can set here.

```js
const config = {
    // ...
    cachePrefix: {
        keys: 'prefix-for-keys:',
        queries: 'prefix-for-queries:',
    },
};
```

This is the complete configuration with the **default** values:

```js
const config = {
    stores: [
        {
            store: 'memory',
            max: 100, // max number of items in the LRU memory cache
        },
    ],
    ttl: {
        keys: 60 * 10, // 10 minutes
        queries: 5, // 5 seconds
        // the "stores" configuration is only needed when you provide multiple stores
        stores: {
            memory: {
                keys: 60 * 5, // 5 minutes
                queries: 5,
            },
            redis: {
                keys: 60 * 60 * 24, // 1 day
                queries: 0, // infinite
            },
        },
    },
    cachePrefix: {
        keys: 'gck:',
        queries: 'gcq:',
    },
};

const datastore = new Datastore();

// Initialize gstore cache with the datastore instance and the config
gstoreCache.init({ datastore, config });
```

#### `gstoreCache.instance()`

Get the gstore cache instance.

---

### gstoreCacheInstance.keys

#### `read(key|Array<key> [options, fetchHandler]])`

read is a helper that will: check the cache, if no entity(ies) are found in the cache, it will fetch the entity(ies) in the Datastore. Finally it will prime the cache with the entity(ies).

* _key_: a Datastore Key or an Array of Datastore Keys. If it is an array of keys, only the keys that are **not found in the cache** will be passed to the fetchHandler.

* _options_: an optional object of options.

```js
{
    ttl: 900, // custom TTL value
}

// For multi-stores it can also be an object
{
    ttl: {  memory: 300, redis: 3600 }
}
```

* _fetchHandler_: an optional function handler to fetch the keys. If it is not provided it will default to the `datastore.get()` method.

```js
const gstoreCache = require('gstore-cache');
const Datastore = require('@google-cloud/datastore');

const datastore = new Datastore();
const cache = gstoreCache.instance();

const key = datastore.key(['Company', 'Google']);

/**
 * 1. Basic example (using the default fetch handler)
 */
cache.keys.read(key)
    .then(entity => console.log(entity));

/**
 * 2. Example with a custom fetch handler that first gets the key from the Datastore,
 * then runs a query and add the entities from the response to the fetched entity.
 */
const fetchHandler = (key) => (
    datastore.get(key)
        .then((company) => {
            // Let's add the latest Posts of the company.
            // We'll have to be careful not to forget to delete this cache
            // when creating new Posts.
            const query = datastore.createQuery('Posts')
                .filter('companyId', key.id)
                .limit(10);

            return query.run()
                .then(response => {
                    company.posts = response[0];

                    // This is the data that will be saved in the cache
                    return company;
                });
        });
);

cache.keys.read(key, fetchHandler)
    .then((entity) => {
        console.log(entity);
    });

// or with a custom TTL
cache.keys.read(key, { ttl: 900 }, fetchHandler)
    .then((entity) => {
        console.log(entity);
    });
```

#### `get(key)`

Retrieve an entity from the cache passing a Datastore Key

```js
const key = datastore.key(['Company', 'Google']);

cache.keys.get(key).then(entity => {
    console.log(entity);
});
```

#### `mget(key [, key2, key3, ...])`

Retrieve multiple entities from the cache.

```js
const key1 = datastore.key(['Company', 'Google']);
const key2 = datastore.key(['Company', 'Twitter']);

cache.keys.mget(key1, key2).then(entities => {
    console.log(entities[0]);
    console.log(entities[1]);
});
```

#### `set(key, entity, [, options])`

Add an entity in the cache.

* _options_: an optional object of options.

```js
{
    ttl: 900, // custom TTL value
}

// For multi-stores it can also be an object
{
    ttl: {  memory: 300, redis: 3600 }
}
```

```js
const key = datastore.key(['Company', 'Google']);

datastore.get(key).then(response => {
    cache.keys.set(key, response[0]).then(() => {
        // ....
    });
});
```

#### `mset(key, entity [, key(n), entity(n), options])`

Add multiple entities in the cache.

* _options_: an optional object of options.

```js
{
    ttl: 900, // custom TTL value
}

// For multi-stores it can also be an object
{
    ttl: {  memory: 300, redis: 3600 }
}
```

```js
const key1 = datastore.key(['Company', 'Google']);
const key2 = datastore.key(['Company', 'Twitter']);

datastore.get([key1, key2]).then(response => {
    const [entities] = response;

    // warning: the datastore.get() method (passing multiple keys) does not garantee
    // the order of the returned entities. You will need to add some logic to sort
    // the response or use the "read" helper above that does it for you.

    cache.keys.mset(key1, entities[0], key2, entities[1], { ttl: 240 }).then(() => ...);
});
```

#### `del(key [, key2, key3, ...])`

Delete one or multiple keys from the cache

```js
const key1 = datastore.key(['Company', 'Google']);
const key2 = datastore.key(['Company', 'Twitter']);

// Single key
cache.keys.del(key1).then(() => { ... });

// Multiple keys
cache.keys.del(key1, key2).then(() => { ... });
```

---

### gstoreCacheInstance.queries

#### `read(query [, fetchHandler])`

read is a helper that will: check the cache, if the query is not found in the cache, it will run the query on the Datastore. Finally it will prime the cache with the response of the query.

* _query_: a Datastore Query.

* _options_: an optional object of options.

```js
{
    ttl: 900, // custom TTL value
}

// For multi-stores it can also be an object
{
    ttl: {  memory: 300, redis: 3600 }
}
```

* _fetchHandler_: an optional function handler to fetch the query. If it is not provided it will default to the `query.run()` method.

```js
const gstoreCache = require('gstore-cache');
const Datastore = require('@google-cloud/datastore');

const datastore = new Datastore();
const cache = gstoreCache.instance();

const query = datastore
    .createQuery('Post')
    .filter('category', 'tech')
    .order('updatedOn')
    .limit(10);

/**
 * 1. Basic example (using the default fetch handler)
 */
cache.queries.read(query)
    .then(response => console.log(response[0]));

/**
 * 2. Example with a custom fetch handler.
 */
const fetchHandler = (q) => (
    q.run()
        .then((response) => {
            const [entities] = response;
            // ... do anything with the entities

            return response;  // return the whole response (both entities + query meta) to the cache
        });
);

cache.queries.read(query, fetchHandler)
    .then((response) => {
        console.log(response[0]);
        console.log(response[1].moreResults);
    });
```

#### `get(query)`

Retrieve a query from the cache passing a Datastore Query

```js
const query = datastore.createQuery('Post').filter('category', 'tech');

cache.queries.get(query).then(response => {
    console.log(response[0]);
});
```

#### `mget(query [, query2, query3, ...])`

Retrieve multiple queries from the cache.

```js
const query1 = datastore.createQuery('Post').filter('category', 'tech');
const query2 = datastore.createQuery('User').filter('score', '>', 1000);

cache.queries.mget(query1, query2).then(response => {
    console.log(response[0]); // response from query1
    console.log(response[1]); // response from query2
});
```

#### `set(query, data [, options])`

Add a query in the cache

* _options_: an optional object of options.

```js
{
    ttl: 900, // custom TTL value
}

// For multi-stores it can also be an object
{
    ttl: {  memory: 300, redis: 3600 }
}
```

```js
const query = datastore.createQuery('Post').filter('category', 'tech');

query.run().then(response => {
    cache.queries.set(query).then(response => {
        console.log(response[0]);
    });
});
```

#### `mset(query, data [, query(n), data(n), options])`

Add multiple queries in the cache.

* _options_: an optional object of options.

```js
{
    ttl: 900, // custom TTL value
}

// For multi-stores it can also be an object
{
    ttl: {  memory: 300, redis: 3600 }
}
```

```js
const query1 = datastore.createQuery('Post').filter('category', 'tech');
const query2 = datastore.createQuery('User').filter('score', '>', 1000);

Promise.all([query1.run(), query2.run()])
    .then(result => {
        cache.queries.mset(query1, result[0], query2, result[1], { ttl: 900 })
            .then(() => ...);
    });
```

#### `kset(key, value, entityKind|Array<EntityKind> [, options])`

**Important:** this method is only available if you provided a _Redis_ store during initialization.

If you have a complex data resulting from several queries and targeting one or multiple Entiy Kind, you can cache it and link the Entity Kind(s) to it. Let's see it in an example:

```js
const gstoreCache = require('gstore-cache');
const cache = gstoreCache.instance();

/**
 * Handler to fetch all the data for our Home Page
 */
const fetchHomeData = () => {
    // Check the cache first...
    cache.get('website:home').then(data => {
        if (data) {
            return data;
        }

        // Cache not found, query the data
        const queryPosts = datastore
            .createQuery('Posts')
            .filter('category', 'tech')
            .limit(10)
            .order('publishedOn', { descending: true });

        const queryTopStories = datastore
            .createQuery('Posts')
            .order('score', { descending: true })
            .limit(3);

        const queryProducts = datastore.createQuery('Products').filter('featured', true);

        return Promise.all([queryPosts.run(), queryTopStories.run(), queryProducts.run()]).then(result => {
            // Build our data object
            const homeData = {
                posts: result[0],
                topStories: result[1],
                products: result[2],
            };

            // We save the result of the 3 queries to the cache ("website:home" key)
            // and link the data to the "Posts" & "Products" Entity Kinds.
            // We can now safely keep the cache infinitely until we add/edit or delete a "Posts" or a "Products".
            return cache.queries.kset('website:home', homeData, ['Posts', 'Products']);
        });
    });
};
```

#### `clearQueriesEntityKind(entityKind|Array<EntityKind>)`

Delete all the queries linked to one or several Entity Kinds.

```js
// ... continuing from the example above.

// Create a new "Posts" Entity Kind
const key = datastore.key(['Posts']);
const data = { title: 'My new post', text: 'Body text of the post' };

datastore.save({ key, data })
    .then(() => {
        // Invalidate all the queries linked to "Posts" Entity Kinds.
        cache.queries.clearQueriesEntityKind(['Posts'])
            .then(() => {
                ...
            });
    });
```

#### `del(query [, query2, query3, ...])`

Delete one or multiple queries from the cache

```js
const query1 = datastore.createQuery('Post').filter('category', 'tech');
const query2 = datastore.createQuery('User').filter('score', '>', 1000);

// Single query
cache.queries.del(query1).then(() => { ... });

// Multiple queries
cache.queries.del(query1, query2).then(() => { ... });
```

---

### "cache-manager" methods bindings (get, mget, set, mset, del, reset)

gstore cache has bindings set to the underlying "cache-manager" methods _get_, _mget_, _set_, _mset_, _del_ and _reset_. This allows you to cache any other data you need. Refer to [the cache-manager documentation](https://github.com/BryanDonovan/node-cache-manager).

```js
const gstoreCache = require('gstore-cache');
const cache = gstoreCache.instance();

cache.set('my-key', { data: 123 }).then(() => ...);

cache.get('my-key').then((data) => console.log(data));

cache.set('my-key1', true, 'my-key2', 123, { ttl: 60 }).then(() => ...);

cache.mget('my-key1', 'my-key2').then((data) => {
    const [data1, data2] = data;
});

cache.del(['my-key1', 'my-key2']).then(() => ...);

// Clears the cache
cache.reset().then(() => ...);
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

* 1.0.0
    * First Release

## Meta

Sébastien Loix – [@sebloix](https://twitter.com/sebloix) – sebastien@loix.me

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
