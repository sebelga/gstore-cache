/* eslint-disable import/no-extraneous-dependencies */

'use strict';

const chai = require('chai');
const sinon = require('sinon');
const ds = require('@google-cloud/datastore')();
const nodeCacheManager = require('cache-manager');

const gstoreCache = require('../lib');
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
            gsCache = gstoreCache.init();

            const { config } = gsCache;
            expect(config.ttl.keys).equal(600);
            expect(config.ttl.queries).equal(5);
            expect(config.global).equal(true);
            expect(config.cachePrefix).deep.equal({ keys: 'gck:', queries: 'gcq:' });

            // Wait next tick to create another cache
            // to make sure the "ready" listener is only on this new cache.
            process.nextTick(() => {
                gsCache = gstoreCache.init({
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

            gsCache = gstoreCache.init({
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
            sinon.stub(nodeCacheManager, 'caching').callsFake(store => StoreMock(store));

            gsCache = gstoreCache.init({
                config: {
                    stores: ['memory', 'redis'],
                    ttl: {
                        keys: 30,
                        queries: 30,
                    },
                },
            });

            const onReady = () => {
                assert.isDefined(gsCache.redisClient);
                gsCache.removeListener('ready', onReady);
                nodeCacheManager.caching.restore();
                done();
            };

            gsCache.on('ready', onReady);
        });

        it('should return same instances', () => {
            gsCache = gstoreCache.init();
            const gsCache2 = gstoreCache.instance();

            expect(gsCache2).equal(gsCache);
        });

        it('should save google datastore instance', () => {
            gsCache = gstoreCache.init({ datastore: ds });

            expect(gsCache.ds).equal(ds);
        });
    });

    describe('primeCache()', () => {
        let cacheManager;
        beforeEach(done => {
            gsCache = gstoreCache.init({ datastore: ds });

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
            gsCache = gstoreCache.init();
            gsCache.on('ready', () => {
                assert.isDefined(gsCache.cacheManager);
                done();
            });
        });
    });

    describe('deleteCacheManager()', () => {
        it('should work', done => {
            gsCache = gstoreCache.init();

            gsCache.deleteCacheManager(() => {
                gsCache.deleteCacheManager(done);
            });
        });
    });

    describe('get|mget|set|mset|del|reset', () => {
        it('should bind to cache-manager methods', () => {
            gsCache = gstoreCache.init();
            const { cacheManager } = gsCache;

            expect(gsCache.get).equal(cacheManager.get);
            expect(gsCache.mget).equal(cacheManager.mget);
            expect(gsCache.set).equal(cacheManager.set);
            expect(gsCache.mset).equal(cacheManager.mset);
            expect(gsCache.del).equal(cacheManager.del);
            expect(gsCache.reset).equal(cacheManager.reset);
        });
    });
});
