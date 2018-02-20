'use strict';

const arrify = require('arrify');
const utils = require('./utils');

const { dsQueryToString } = utils.datastore;
const { is } = utils;

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
    const cacheQueryEntityKind = (queryKey, value, ...entityKind) =>
        new Promise((resolve, reject) => {
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
    const cleanQueriesEntityKind = entityKind =>
        new Promise((resolve, reject) => {
            const keySetQueries = cache.config.cachePrefix.queries + entityKind;
            cache.redisClient.smembers(keySetQueries, (err, _members) => {
                if (err) {
                    return reject(err);
                }
                const members = arrify(_members);
                return cache.redisClient.del([...members, keySetQueries], (errDel, res) => {
                    if (errDel) {
                        return reject(errDel);
                    }
                    return resolve(res);
                });
            });
        });

    /**
     * Get a Query from the Cache
     */
    const wrap = (query, ...args) => {
        let fetchHandler = args.length > 1 ? args[1] : args[0];

        if (typeof fetchHandler !== 'function') {
            /**
             * If no fetchHandler is passed, defaults to query.run()
             */
            fetchHandler = query.run;
        }

        const options = is.object(args[0]) ? args[0] : {};

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
        options.ttl = ttl;

        if (
            !cache.cacheManager ||
            ttl === -1 ||
            options.cache === false ||
            (cache.config.global === false && options.cache !== true)
        ) {
            return fetchHandler(query);
        }

        const queryKey = queryToString(query);

        return cache.cacheManager.get(queryKey, options).then(onResult);

        function onResult(cacheResult) {
            if (typeof cacheResult === 'undefined') {
                /**
                 * No cache we need to fetch the keys
                 */
                return fetchHandler(query).then(fetchResult => {
                    const ttlQueries =
                        cache.config.ttl.stores &&
                        cache.config.ttl.stores.redis &&
                        cache.config.ttl.stores.redis.queries;
                    if (typeof cache.redisClient !== 'undefined' && ttlQueries === 0) {
                        // Save the response directly in Redis
                        return _this
                            .cacheQueryEntityKind(queryKey, fetchResult, query.kinds[0])
                            .then(() => fetchResult);
                    }
                    // Prime the cache
                    return cache.primeCache(queryKey, fetchResult, options);
                });
            }

            return cacheResult;
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

        const options = { ttl: cache.config.ttl.queries };

        if (args.length === 2) {
            return cache.set(...[args[0], args[1], options]);
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
