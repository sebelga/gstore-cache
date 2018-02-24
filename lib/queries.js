'use strict';

const arrify = require('arrify');
const utils = require('./utils');

const { dsQueryToString } = utils.datastore;
const { is } = utils;

const getTTLQueries = cache => {
    let ttl;
    if (cache.config.stores.length > 1) {
        /**
         * If we have several stores we calculate ttl dynamically
         * according to which store we are adding the cached query
         */
        ttl = (data, storeName) => cache.config.ttl.stores[storeName].queries;
    } else {
        ttl = cache.config.ttl.queries;
    }

    const ttlRedis = cache.config.ttl.stores && cache.config.ttl.stores.redis && cache.config.ttl.stores.redis.queries;

    return {
        default: ttl,
        redis: ttlRedis,
    };
};

module.exports = cache => {
    let _this;

    const addCachePrefixKeys = key => cache.config.cachePrefix.queries + key;
    const queryToString = key => addCachePrefixKeys(dsQueryToString(key));

    /**
     * When a Redis Client is present we save the response of the Query to cache
     * and we also add its the cache key to a Set of Queries for the Entity Kind.
     * If later on the entity kind is modified or deleted, we can then easily remove
     * all the queries cached for that Entiy Kind with "cleanQueriesEntityKind()" below
     */
    const cacheQueryEntityKind = (queryKey, value, _entityKind) =>
        new Promise((resolve, reject) => {
            const entityKind = arrify(_entityKind);
            const keysSetsQueries = entityKind.map(kind => cache.config.cachePrefix.queries + kind);
            cache.redisClient
                .multi([
                    ...keysSetsQueries.map(keySet => ['sadd', keySet, queryKey]),
                    ['set', queryKey, JSON.stringify(value)],
                ])
                .exec((err, response) => {
                    if (err) {
                        return reject(err);
                    }
                    return resolve(response);
                });
        });

    /**
     * Remove all the queries in cache for an Entity Kind
     * This will remove from Redis all the queries saved
     * in our <EntityKind> Set
     */
    const cleanQueriesEntityKind = _entityKinds =>
        new Promise((resolve, reject) => {
            const entityKinds = arrify(_entityKinds);

            /**
             * Get the list of Redis Keys for each EntiyKind Set
             */
            const setsQueries = entityKinds.map(entityKind => cache.config.cachePrefix.queries + entityKind);

            cache.redisClient.multi([...setsQueries.map(set => ['smembers', set])]).exec((err, response) => {
                if (err) {
                    return reject(err);
                }

                const members = response.reduce((acc, res) => [...acc, ...res], []);
                const keysToDelete = new Set([...members, ...setsQueries]);

                return cache.redisClient.del(Array.from(keysToDelete), (errDel, res) => {
                    if (errDel) {
                        return reject(errDel);
                    }
                    return resolve(res);
                });
            });
        });

    /**
     * Get a Query from the Cache
     * If it is not found, fetch it and then prime the cache
     */
    const wrap = (query, ...args) => {
        let fetchHandler = args.length > 1 ? args[1] : args[0];

        if (typeof fetchHandler !== 'function') {
            /**
             * If no fetchHandler is passed, defaults to query.run()
             */
            fetchHandler = query.run.bind(query);
        }
        const ttlQueries = getTTLQueries(cache);
        const options = is.object(args[0]) ? args[0] : {};
        options.ttl = ttlQueries.default;

        if (
            !cache.cacheManager ||
            ttlQueries.default === -1 ||
            options.cache === false ||
            (cache.config.global === false && options.cache !== true)
        ) {
            return fetchHandler(query);
        }

        const queryKey = queryToString(query);

        return cache.cacheManager.get(queryKey, options).then(onResult);

        function onResult(resultCached) {
            if (typeof resultCached === 'undefined') {
                /**
                 * No cache we need to fetch the keys
                 */
                return fetchHandler(query).then(resultFetched => {
                    if (typeof cache.redisClient !== 'undefined' && ttlQueries.redis === 0) {
                        // Save the response directly in Redis
                        return _this
                            .cacheQueryEntityKind(queryKey, resultFetched, query.kinds[0])
                            .then(() => resultFetched);
                    }
                    // Prime the cache
                    return cache.primeCache(queryKey, resultFetched, options);
                });
            }

            return resultCached;
        }
    };

    const mget = (..._keys) => {
        const keys = _keys.map(k => queryToString(k));
        if (keys.length === 1) {
            return cache.get(keys[0]);
        }

        return cache.mget(...keys);
    };

    const get = mget;

    const mset = (...keysValues) => {
        // Convert Datastore Keys to unique string id
        const args = keysValues.map((kv, i) => {
            if (i % 2 === 0) {
                return queryToString(kv);
            }
            return kv;
        });

        const ttlQueries = getTTLQueries(cache);
        const options = { ttl: ttlQueries.default };

        /**
         * If there is a redisClient and the ttl for redis has been set to "0"
         * it means "infinite". We will save the query in a Redis Set of the Query Entity Kind.
         */
        if (typeof cache.redisClient !== 'undefined' && ttlQueries.redis === 0) {
            let query;
            let queryKey;
            let queryData;

            /**
             * If there are only 1 query with its data we call our cacheQueryEntityKind
             * method and return the queryData
             */
            if (args.length === 2) {
                [query] = keysValues;
                [queryKey, queryData] = args;
                return _this.cacheQueryEntityKind(queryKey, queryData, query.kinds[0]).then(() => queryData);
            }

            /**
             * If there are several query|data pairs then we loop through each pair
             * and call the cacheQueryEntityKind() method
             */
            return args.slice(0, args.length * 0.5).reduce(
                (promise, x, i) =>
                    promise.then(result => {
                        const index = i + i * 1; // eslint-disable-line
                        query = keysValues[index];
                        queryKey = args[index];
                        queryData = args[index + 1];

                        return _this
                            .cacheQueryEntityKind(queryKey, queryData, query.kinds[0])
                            .then(() => (result ? [...result, queryData] : [queryData]));
                    }),
                Promise.resolve()
            );
        }

        if (args.length === 2) {
            return cache.set(args[0], args[1], options);
        }
        return cache.mset(...[...args, options]);
    };

    const set = mset;

    const del = (...keys) => cache.del(keys.map(k => queryToString(k)));

    /**
     * We save the object reference in a "_this" variable
     * for easier test spying.
     */
    _this = {
        cacheQueryEntityKind,
        cleanQueriesEntityKind,
        wrap,
        get,
        mget,
        set,
        mset,
        del,
    };
    return _this;
};
