import base from './stripe-live-sandbox.config.mts';
export default {...base,test:{...base.test,include:['tests/postgres/stripe-live-webhook.postgres.ts'],testTimeout:600000}};
