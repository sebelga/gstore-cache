/* eslint-disable import/no-extraneous-dependencies */

'use strict';

const chai = require('chai');
const sinon = require('sinon');
const ds = require('@google-cloud/datastore')();

const GstoreCache = require('../lib');
const StoreMock = require('./mocks/cache-store');

const { expect, assert } = chai;

describe('gsCache', () => {
    let gsCache;

    beforeEach(done => {
        if (!gsCache) {
            done();
        }

        gsCache.deleteCacheManager(() => {
            gsCache.removeAllListeners();
            gsCache = undefined;
            done();
        });
    });

    describe('init()', () => {
        it('should override the default config', done => {
            gsCache = GstoreCache();

            const { config } = gsCache;
            expect(config.ttl.keys).equal(600);
            expect(config.ttl.queries).equal(5);
            expect(config.global).equal(true);
            expect(config.cachePrefix).deep.equal({ keys: 'gck:', queries: 'gcq:' });

            // Wait next tick to create another cache
            // to make sure the "ready" listener is only on this new cache.
            process.nextTick(() => {
                gsCache = GstoreCache({
                    config: {
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
                    },
                });

                const onGstoreReady = () => {
                    const newConfig = gsCache.config;

                    expect(newConfig.ttl.keys).equal(30);
                    expect(newConfig.ttl.queries).equal(30);
                    expect(newConfig.global).equal(false);
                    expect(newConfig.cachePrefix).deep.equal({ keys: 'customk:', queries: 'customq:' });

                    gsCache.removeListener('ready', onGstoreReady);
                    done();
                };

                gsCache.on('ready', onGstoreReady);
            });
        });

        it('should detect redis client', () => {
            const redisCache = StoreMock('redis');

            gsCache = GstoreCache({
                config: {
                    stores: [redisCache],
                    ttl: {
                        keys: 30,
                        queries: 30,
                    },
                },
            });

            assert.isDefined(gsCache.redisClient);
        });

        it('should detect redis client (multi store)', done => {
            const memoryCache = StoreMock();
            const redisCache = StoreMock('redis');

            gsCache = GstoreCache({
                config: {
                    stores: [memoryCache, redisCache],
                    ttl: {
                        keys: 30,
                        queries: 30,
                    },
                },
            });

            const onReady = () => {
                assert.isDefined(gsCache.redisClient);
                gsCache.removeListener('ready', onReady);
                done();
            };

            gsCache.on('ready', onReady);
        });

        it('should return same instances', () => {
            gsCache = GstoreCache();
            const gstoreCache2 = GstoreCache();

            expect(gstoreCache2).equal(gsCache);
        });

        it('should save google datastore instance', () => {
            gsCache = GstoreCache({ datastore: ds });

            expect(gsCache.ds).equal(ds);
        });
    });

    describe('primeCache()', () => {
        let cacheManager;
        beforeEach(done => {
            gsCache = GstoreCache({ datastore: ds });

            const onReady = () => {
                ({ cacheManager } = gsCache);
                gsCache.removeAllListeners();
                done();
            };
            gsCache.on('ready', onReady);
        });

        it('should concatenate key|value pairs and return single value', () => {
            sinon.stub(cacheManager, 'mset').resolves(['Mick Jagger']);

            return gsCache.primeCache('user123', 'Mick Jagger').then(response => {
                expect(response).equal('Mick Jagger');
                cacheManager.mset.restore();
            });
        });

        it('should concatenate key|value pairs and return multiple value', () => {
            sinon.stub(cacheManager, 'mset').resolves(['Mick Jagger', 'John Snow']);

            return gsCache.primeCache(['user123'], ['john snow']).then(response => {
                expect(response[0]).equal('Mick Jagger');
                expect(response[1]).equal('John Snow');
            });
        });

        it('should maintain value as Array', () => {
            sinon.stub(cacheManager, 'mset').resolves(['Mick Jagger']);

            return gsCache.primeCache('user123', ['Mick Jagger']).then(() => {
                const { args } = cacheManager.mset.getCall(0);
                assert.ok(Array.isArray(args[1]));
                expect(args[1][0]).equal('Mick Jagger');
                cacheManager.mset.restore();
            });
        });
    });

    describe('getCacheManager()', () => {
        it('should return the cache manager', done => {
            gsCache = GstoreCache();
            gsCache.on('ready', () => {
                assert.isDefined(gsCache.cacheManager);
                done();
            });
        });
    });

    describe('deleteCacheManager()', () => {
        it('should work', done => {
            gsCache = GstoreCache();

            gsCache.deleteCacheManager(() => {
                gsCache.deleteCacheManager(done);
            });
        });
    });

    describe('get|mget|set|mset|del', () => {
        it('should bind to cache-manager methods', () => {
            gsCache = GstoreCache();
            const { cacheManager } = gsCache;

            expect(gsCache.get).equal(cacheManager.get);
            expect(gsCache.mget).equal(cacheManager.mget);
            expect(gsCache.set).equal(cacheManager.set);
            expect(gsCache.mset).equal(cacheManager.mset);
            expect(gsCache.del).equal(cacheManager.del);
        });
    });
});
