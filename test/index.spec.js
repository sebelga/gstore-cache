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
        it('should override the default ttl values', () => {
            gstoreCache.init(true);

            expect(gstoreCache.ttl().keys).equal(600);
            expect(gstoreCache.ttl().queries).equal(60);
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
            });
            expect(gstoreCache.ttl().keys).equal(30);
            expect(gstoreCache.ttl().queries).equal(30);
        });

        it('should detect redis client', () => {
            gstoreCache.init({
                stores: [{ store: redisStore, db: 0, ttl: 600 }],
                ttl: {
                    keys: 30,
                    queries: 30,
                },
            });
            redisClient = gstoreCache.redisClient();
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
            redisClient = gstoreCache.redisClient();
            assert.isDefined(redisClient);
        });
    });

    describe('getKeys()', () => {
        let cacheManager;
        const [key1, key2, key3] = keys;
        const [entity1, entity2, entity3] = entities;

        const methods = {
            fetchHandler() {},
        };

        beforeEach(() => {
            cacheManager = gstoreCache.init(true);
        });

        afterEach(() => {
            methods.fetchHandler.restore();
        });

        it('should get entity from cache', () => {
            sinon.spy(methods, 'fetchHandler');
            cacheManager.set(datastore.dsKeytoString(key1), entity1);

            return gstoreCache.getKeys(key1, methods.fetchHandler).then(result => {
                expect(methods.fetchHandler.called).equal(false);
                expect(result.name).equal('John');
            });
        });

        it('should get entity from fetchHandler', () => {
            sinon.stub(methods, 'fetchHandler').resolves(entity3);

            return gstoreCache.getKeys(key1, methods.fetchHandler).then(result => {
                expect(methods.fetchHandler.called).equal(true);
                expect(result.name).equal('Carol');
            });
        });

        it('should get entities from cache + fetch', () => {
            cacheManager.set(datastore.dsKeytoString(key1), entity1);
            cacheManager.set(datastore.dsKeytoString(key2), entity2);

            sinon.stub(methods, 'fetchHandler').resolves(entity3);

            return gstoreCache.getKeys([key1, key2, key3], methods.fetchHandler).then(result => {
                expect(methods.fetchHandler.called).equal(true);
                expect(result[0].name).equal('John');
                expect(result[1].name).equal('Mick');
                expect(result[2].name).equal('Carol');
            });
        });

        it('should return "null" for fetch not found (404)', () => {
            const error = new Error('not found');
            error.code = 404;

            cacheManager.set(datastore.dsKeytoString(key1), entity1);
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

        it('should buble up the error from the fetch (2)', done => {
            const error = new Error('Houston we got an error');
            cacheManager.set(datastore.dsKeytoString(key1), entity1);
            sinon.stub(methods, 'fetchHandler').rejects(error);

            gstoreCache.getKeys([key1, key2], methods.fetchHandler).catch(err => {
                expect(err.message).equal('Error: Houston we got an error');
                done();
            });
        });
    });
});
