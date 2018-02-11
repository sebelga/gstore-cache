'use strict';

const ds = require('@google-cloud/datastore')();
const chai = require('chai');
const sinon = require('sinon');

const GstoreCache = require('../lib');
const { datastore, string } = require('../lib/utils');
const { keys, entities } = require('./mocks/datastore');

const { expect, assert } = chai;

describe('gstoreCache.keys', () => {
    let gsCache;
    let cacheManager;
    let keyToString;

    const [key1, key2, key3] = keys;
    const [entity1, entity2, entity3] = entities;

    const methods = {
        fetchHandler() {},
    };

    beforeEach(done => {
        gsCache = GstoreCache(true);

        gsCache.on('ready', () => {
            keyToString = key => gsCache.config.cachePrefix.keys + datastore.dsKeyToString(key);
            ({ cacheManager } = gsCache);
            done();
        });
    });

    afterEach(() => {
        if (methods.fetchHandler.restore) {
            methods.fetchHandler.restore();
        }
        gsCache.removeAllListeners();
    });

    describe('wrap()', () => {
        it('should get entity from cache (1)', () => {
            sinon.spy(methods, 'fetchHandler');
            const value = { name: string.random() };
            cacheManager.set(keyToString(key1), value);

            return gsCache.keys.wrap(key1, methods.fetchHandler).then(result => {
                expect(methods.fetchHandler.called).equal(false);
                expect(result.name).equal(value.name);
                expect(result[ds.KEY]).equal(key1);
            });
        });

        it('should get entity from cache (2)', () => {
            sinon.spy(methods, 'fetchHandler');
            gsCache.config.global = false;
            cacheManager.mset(keyToString(key1), entity1, keyToString(key2), entity2);

            return gsCache.keys.wrap([key1, key2], { cache: true }, methods.fetchHandler).then(results => {
                expect(methods.fetchHandler.called).equal(false);
                expect(results[0].name).equal('John');
                expect(results[1].name).equal('Mick');
                expect(results[0][ds.KEY]).equal(key1);
                expect(results[1][ds.KEY]).equal(key2);
            });
        });

        it('should *not* get entity from cache (1)', () => {
            sinon.stub(methods, 'fetchHandler').resolves([]);
            gsCache.config.global = false;
            cacheManager.set(keyToString(key1), entity1);

            return gsCache.keys.wrap(key1, methods.fetchHandler).then(() => {
                expect(methods.fetchHandler.called).equal(true);
            });
        });

        it('should *not* get entity from cache (2)', () => {
            sinon.stub(methods, 'fetchHandler').resolves([]);
            cacheManager.set(keyToString(key1), entity1);

            return gsCache.keys.wrap(key1, { cache: false }, methods.fetchHandler).then(() => {
                expect(methods.fetchHandler.called).equal(true);
            });
        });

        it('should get entity from fetchHandler', () => {
            sinon.stub(methods, 'fetchHandler').resolves(entity3);

            return gsCache.keys.wrap(key3, methods.fetchHandler).then(result => {
                expect(methods.fetchHandler.called).equal(true);
                expect(result.name).equal('Carol');

                return cacheManager.get(keyToString(key3)).then(cacheResponse => {
                    expect(cacheResponse.name).equal('Carol');
                });
            });
        });

        it('should prime the cache after fetch', () => {
            sinon.stub(methods, 'fetchHandler').resolves([entity1, entity2]);

            return gsCache.keys.wrap([key1, key2], methods.fetchHandler).then(() =>
                cacheManager.mget(keyToString(key1), keyToString(key2)).then(results => {
                    expect(results[0].name).equal('John');
                    expect(results[1].name).equal('Mick');
                })
            );
        });

        it('should get entities from cache + fetch', () => {
            cacheManager.set(keyToString(key1), entity1);
            cacheManager.set(keyToString(key2), entity2);

            sinon.stub(methods, 'fetchHandler').resolves(entity3);

            return gsCache.keys.wrap([key1, key2, key3], methods.fetchHandler).then(results => {
                expect(methods.fetchHandler.called).equal(true);
                expect(results[0].name).equal('John');
                expect(results[1].name).equal('Mick');
                expect(results[2].name).equal('Carol');

                expect(results[0][ds.KEY]).equal(key1);
                expect(results[1][ds.KEY]).equal(key2);
                expect(results[2][ds.KEY]).equal(key3);
            });
        });

        it('should return "null" for fetch not found ("ERR_ENTITY_NOT_FOUND")', () => {
            const error = new Error('not found');
            error.code = 'ERR_ENTITY_NOT_FOUND';

            cacheManager.set(keyToString(key1), entity1);
            sinon.stub(methods, 'fetchHandler').returns(Promise.reject(error));

            return gsCache.keys.wrap([key1, key2], methods.fetchHandler).then(result => {
                expect(result[0].name).equal('John');
                expect(result[1]).equal(null);
            });
        });

        it('should buble up the error from the fetch (1)', done => {
            const error = new Error('Houston we got an error');

            sinon.stub(methods, 'fetchHandler').rejects(error);

            gsCache.keys.wrap(key1, methods.fetchHandler).catch(err => {
                expect(err.message).equal('Houston we got an error');
                done();
            });
        });

        it('should bubble up the error from the fetch (2)', done => {
            const error = new Error('Houston we got an error');
            cacheManager.set(keyToString(key1), entity1);
            sinon.stub(methods, 'fetchHandler').rejects(error);

            gsCache.keys.wrap([key1, key2], methods.fetchHandler).catch(err => {
                expect(err.message).equal('Error: Houston we got an error');
                done();
            });
        });
    });

    describe('get()', () => {
        it('should get key from cache', () => {
            const value = { name: 'john' };
            return gsCache.keys.set(key1, value).then(() => {
                gsCache.keys.get(key1).then(res => {
                    expect(res).equal(value);
                });
            });
        });

        it('should add KEY Symbol to response from cache', () => {
            const value = { name: 'john' };
            return gsCache.keys.set(key1, value).then(() =>
                gsCache.keys.get(key1).then(res => {
                    assert.ok(!Array.isArray(res));
                    expect(res).include(value);
                    expect(res[ds.KEY]).equal(key1);
                })
            );
        });

        it('should get multiple keys from cache', () => {
            const value1 = { name: string.random() };
            const value2 = { name: string.random() };
            return gsCache.keys.set(key1, value1, key2, value2).then(() =>
                gsCache.keys.mget(key1, key2).then(res => {
                    expect(res[0]).deep.equal(value1);
                    expect(res[1]).deep.equal(value2);
                    expect(res[0][ds.KEY]).equal(key1);
                    expect(res[1][ds.KEY]).equal(key2);
                })
            );
        });
    });

    describe('set()', () => {
        it('should add key to cache', () => {
            const value = { name: 'john' };
            sinon.spy(gsCache, 'set');
            return gsCache.keys.set(key1, value).then(result => {
                assert.ok(gsCache.set.called);
                const { args } = gsCache.set.getCall(0);
                expect(args[0]).equal(keyToString(key1));
                expect(result.name).equal('john');
            });
        });
    });

    describe('mset()', () => {
        it('should add multiple keys to cache', () => {
            const value1 = { name: 'john' };
            const value2 = { name: 'mick' };

            sinon.spy(gsCache, 'mset');
            return gsCache.keys.mset(key1, value1, key2, value2).then(result => {
                assert.ok(gsCache.mset.called);
                const { args } = gsCache.mset.getCall(0);
                expect(args[0]).equal(keyToString(key1));
                expect(args[1]).equal(value1);
                expect(args[2]).equal(keyToString(key2));
                expect(args[3]).equal(value2);
                expect(result).include.members([value1, value2]);
            });
        });
    });

    describe('del()', () => {
        it('should delete 1 key from cache', () => {
            sinon.spy(gsCache, 'del');
            return gsCache.keys.del(key1).then(() => {
                assert.ok(gsCache.del.called);
                const { args } = gsCache.del.getCall(0);
                expect(args[0]).deep.equal([keyToString(key1)]);
            });
        });

        it('should delete multiple keys from cache', () => {
            sinon.spy(gsCache, 'del');
            return gsCache.keys.del(key1, key2, key3).then(() => {
                assert.ok(gsCache.del.called);
                const { args } = gsCache.del.getCall(0);
                expect(args[0][0]).deep.equal(keyToString(key1));
                expect(args[0][1]).deep.equal(keyToString(key2));
                expect(args[0][2]).deep.equal(keyToString(key3));
            });
        });
    });
});
