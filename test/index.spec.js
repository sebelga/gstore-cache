/* eslint-disable import/no-extraneous-dependencies */

'use strict';

const chai = require('chai');
const sinon = require('sinon');
const nodeCacheManager = require('cache-manager');
const Redis = require('redis');
const redisStore = require('cache-manager-redis-store');
const redisMock = require('redis-mock');

const gstoreCache = require('../lib');
const { datastore } = require('../lib/utils');
const { keys, entities } = require('./mocks/entities');

const { expect, assert } = chai;

// We override the createClient from redis with a mock
Redis.createClient = (...args) => {
    const client = redisMock.createClient(...args);
    client.options = {};
    return client;
};

describe('gstore-cache', () => {
    let redisClient;

    beforeEach(() => {
        redisClient = undefined;
    });

    afterEach(done => {
        gstoreCache.deleteCacheManager(() => {
            if (redisClient) {
                redisClient.end(true);
            }
            done();
        });
    });

    describe('init()', () => {
        it('should override the default config', () => {
            gstoreCache.init(true);

            let config = gstoreCache.getConfig();
            expect(config.ttl.keys).equal(600);
            expect(config.ttl.queries).equal(60);
            expect(config.global).equal(true);
            expect(config.cachePrefix).deep.equal({ keys: 'gck:', queries: 'gcq:' });

            gstoreCache.init({
                stores: [
                    {
                        store: 'memory',
                        max: 200,
                        ttl: 3000,
                    },
                ],
                ttl: {
                    keys: 30,
                    queries: 30,
                },
                global: false,
                cachePrefix: { keys: 'customk:', queries: 'customq:' },
            });

            config = gstoreCache.getConfig();
            expect(config.ttl.keys).equal(30);
            expect(config.ttl.queries).equal(30);
            expect(config.global).equal(false);
            expect(config.cachePrefix).deep.equal({ keys: 'customk:', queries: 'customq:' });
        });

        it('should detect redis client', () => {
            gstoreCache.init({
                stores: [{ store: redisStore, db: 0, ttl: 600 }],
                ttl: {
                    keys: 30,
                    queries: 30,
                },
            });
            redisClient = gstoreCache.getRedisClient();
            assert.isDefined(redisClient);
        });

        it('should detect redis client (multi store)', () => {
            const memoryCache = nodeCacheManager.caching({ store: 'memory' });
            const redisCache = nodeCacheManager.caching({ store: redisStore, db: 0, ttl: 600 });

            gstoreCache.init({
                stores: [memoryCache, redisCache],
                ttl: {
                    keys: 30,
                    queries: 30,
                },
            });
            redisClient = gstoreCache.getRedisClient();
            assert.isDefined(redisClient);
        });
    });

    describe('getCacheManager()', () => {
        it('should return the cache manager', () => {
            const cacheManager = gstoreCache.init(true);
            expect(cacheManager).equal(gstoreCache.getCacheManager());
        });
    });

    describe('deleteCacheManager()', () => {
        it('should work', done => {
            gstoreCache.deleteCacheManager(() => {
                done();
            });
        });
    });

    describe('getKeys()', () => {
        let cacheManager;
        let config;
        let keyToString;

        const [key1, key2, key3] = keys;
        const [entity1, entity2, entity3] = entities;

        const methods = {
            fetchHandler() {},
        };

        beforeEach(() => {
            cacheManager = gstoreCache.init(true);
            config = gstoreCache.getConfig();

            // Add prefix to all cache keys
            keyToString = key => config.cachePrefix.keys + datastore.dsKeyToString(key);
        });

        afterEach(() => {
            methods.fetchHandler.restore();
        });

        it('should get entity from cache (1)', () => {
            sinon.spy(methods, 'fetchHandler');
            cacheManager.set(keyToString(key1), entity1);

            return gstoreCache.getKeys(key1, methods.fetchHandler).then(result => {
                expect(methods.fetchHandler.called).equal(false);
                expect(result.name).equal('John');
            });
        });

        it('should get entity from cache (2)', () => {
            sinon.spy(methods, 'fetchHandler');
            gstoreCache.getConfig().global = false;
            cacheManager.mset(keyToString(key1), entity1, keyToString(key2), entity2);

            return gstoreCache.getKeys([key1, key2], { cache: true }, methods.fetchHandler).then(results => {
                expect(methods.fetchHandler.called).equal(false);
                expect(results[0].name).equal('John');
                expect(results[1].name).equal('Mick');
            });
        });

        it('should *not* get entity from cache (1)', () => {
            sinon.stub(methods, 'fetchHandler').resolves([]);
            gstoreCache.getConfig().global = false;
            cacheManager.set(keyToString(key1), entity1);

            return gstoreCache.getKeys(key1, methods.fetchHandler).then(() => {
                expect(methods.fetchHandler.called).equal(true);
            });
        });

        it('should *not* get entity from cache (2)', () => {
            sinon.stub(methods, 'fetchHandler').resolves([]);
            cacheManager.set(keyToString(key1), entity1);

            return gstoreCache.getKeys(key1, { cache: false }, methods.fetchHandler).then(() => {
                expect(methods.fetchHandler.called).equal(true);
            });
        });

        it('should get entity from fetchHandler', () => {
            sinon.stub(methods, 'fetchHandler').resolves(entity3);

            return gstoreCache.getKeys(key3, methods.fetchHandler).then(result => {
                expect(methods.fetchHandler.called).equal(true);
                expect(result.name).equal('Carol');

                return cacheManager.get(keyToString(key3)).then(cacheResponse => {
                    expect(cacheResponse.name).equal('Carol');
                });
            });
        });

        it('should prime the cache after fetch', () => {
            sinon.stub(methods, 'fetchHandler').resolves([entity1, entity2]);

            return gstoreCache.getKeys([key1, key2], methods.fetchHandler).then(() => {
                return cacheManager.mget(keyToString(key1), keyToString(key2)).then(results => {
                    expect(results[0].name).equal('John');
                    expect(results[1].name).equal('Mick');
                });
            });
        });

        it('should get entities from cache + fetch', () => {
            cacheManager.set(keyToString(key1), entity1);
            cacheManager.set(keyToString(key2), entity2);

            sinon.stub(methods, 'fetchHandler').resolves(entity3);

            return gstoreCache.getKeys([key1, key2, key3], methods.fetchHandler).then(result => {
                expect(methods.fetchHandler.called).equal(true);
                expect(result[0].name).equal('John');
                expect(result[1].name).equal('Mick');
                expect(result[2].name).equal('Carol');
            });
        });

        it('should return "null" for fetch not found ("ERR_ENTITY_NOT_FOUND")', () => {
            const error = new Error('not found');
            error.code = 'ERR_ENTITY_NOT_FOUND';

            cacheManager.set(keyToString(key1), entity1);
            sinon.stub(methods, 'fetchHandler').returns(Promise.reject(error));

            return gstoreCache.getKeys([key1, key2], methods.fetchHandler).then(result => {
                expect(result[0].name).equal('John');
                expect(result[1]).equal(null);
            });
        });

        it('should buble up the error from the fetch (1)', done => {
            const error = new Error('Houston we got an error');

            sinon.stub(methods, 'fetchHandler').rejects(error);

            gstoreCache.getKeys(key1, methods.fetchHandler).catch(err => {
                expect(err.message).equal('Houston we got an error');
                done();
            });
        });

        it('should bubble up the error from the fetch (2)', done => {
            const error = new Error('Houston we got an error');
            cacheManager.set(keyToString(key1), entity1);
            sinon.stub(methods, 'fetchHandler').rejects(error);

            gstoreCache.getKeys([key1, key2], methods.fetchHandler).catch(err => {
                expect(err.message).equal('Error: Houston we got an error');
                done();
            });
        });
    });
});
