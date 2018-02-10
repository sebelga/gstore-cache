'use strict';

const chai = require('chai');
const sinon = require('sinon');

const GstoreCache = require('../lib');
const { datastore } = require('../lib/utils');
const { keys, entities } = require('./mocks/datastore');

const { expect } = chai;

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

    describe('get()', () => {
        it('should get entity from cache (1)', () => {
            sinon.spy(methods, 'fetchHandler');
            cacheManager.set(keyToString(key1), entity1);

            return gsCache.keys.get(key1, methods.fetchHandler).then(result => {
                expect(methods.fetchHandler.called).equal(false);
                expect(result.name).equal('John');
            });
        });

        it('should get entity from cache (2)', () => {
            sinon.spy(methods, 'fetchHandler');
            gsCache.config.global = false;
            cacheManager.mset(keyToString(key1), entity1, keyToString(key2), entity2);

            return gsCache.keys.get([key1, key2], { cache: true }, methods.fetchHandler).then(results => {
                expect(methods.fetchHandler.called).equal(false);
                expect(results[0].name).equal('John');
                expect(results[1].name).equal('Mick');
            });
        });

        it('should *not* get entity from cache (1)', () => {
            sinon.stub(methods, 'fetchHandler').resolves([]);
            gsCache.config.global = false;
            cacheManager.set(keyToString(key1), entity1);

            return gsCache.keys.get(key1, methods.fetchHandler).then(() => {
                expect(methods.fetchHandler.called).equal(true);
            });
        });

        it('should *not* get entity from cache (2)', () => {
            sinon.stub(methods, 'fetchHandler').resolves([]);
            cacheManager.set(keyToString(key1), entity1);

            return gsCache.keys.get(key1, { cache: false }, methods.fetchHandler).then(() => {
                expect(methods.fetchHandler.called).equal(true);
            });
        });

        it('should get entity from fetchHandler', () => {
            sinon.stub(methods, 'fetchHandler').resolves(entity3);

            return gsCache.keys.get(key3, methods.fetchHandler).then(result => {
                expect(methods.fetchHandler.called).equal(true);
                expect(result.name).equal('Carol');

                return cacheManager.get(keyToString(key3)).then(cacheResponse => {
                    expect(cacheResponse.name).equal('Carol');
                });
            });
        });

        it('should prime the cache after fetch', () => {
            sinon.stub(methods, 'fetchHandler').resolves([entity1, entity2]);

            return gsCache.keys.get([key1, key2], methods.fetchHandler).then(() =>
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

            return gsCache.keys.get([key1, key2, key3], methods.fetchHandler).then(result => {
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

            return gsCache.keys.get([key1, key2], methods.fetchHandler).then(result => {
                expect(result[0].name).equal('John');
                expect(result[1]).equal(null);
            });
        });

        it('should buble up the error from the fetch (1)', done => {
            const error = new Error('Houston we got an error');

            sinon.stub(methods, 'fetchHandler').rejects(error);

            gsCache.keys.get(key1, methods.fetchHandler).catch(err => {
                expect(err.message).equal('Houston we got an error');
                done();
            });
        });

        it('should bubble up the error from the fetch (2)', done => {
            const error = new Error('Houston we got an error');
            cacheManager.set(keyToString(key1), entity1);
            sinon.stub(methods, 'fetchHandler').rejects(error);

            gsCache.keys.get([key1, key2], methods.fetchHandler).catch(err => {
                expect(err.message).equal('Error: Houston we got an error');
                done();
            });
        });
    });
});
