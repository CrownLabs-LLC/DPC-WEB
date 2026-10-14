// Read-only projection of a Stripe checkout. No membership/fulfillment writes.
// Catalog source: DPC billing/circleCheckout.ts at 087532cc (2026-10-14).
export const CATALOG = {
  live: {
    tap_monthly: ['price_1TwogWCtQ9S99QuEJ1dxL1IN', 'price_1TwogWCtQ9S99QuEqwo52ubO'],
    tap_annual: ['price_1TwogWCtQ9S99QuEjiDNNpt0', 'price_1TwogWCtQ9S99QuEhElJsm89'],
    cellar_monthly: ['price_1TwoicCtQ9S99QuEdBG8Uz2v', 'price_1TwoicCtQ9S99QuENykBAT1Z'],
    cellar_annual: ['price_1TwoicCtQ9S99QuEHvnWgPbm', 'price_1TwoicCtQ9S99QuEbATB3Pxd'],
    reserve_monthly: ['price_1TwojxCtQ9S99QuEMIbhbzQA', 'price_1TwojxCtQ9S99QuELBKippuC'],
    reserve_annual: ['price_1TwojxCtQ9S99QuEu8TbsusQ', 'price_1TwojwCtQ9S99QuEYkFcK7cJ'],
    kit: 'price_1UGRnCCtQ9S99QuEA7IcpJzM',
    extras: ['price_1UB0uPCtQ9S99QuEqd0wKMrv', 'price_1TeSf0CtQ9S99QuEAfR3j0bg'],
  },
  test: {
    tap_monthly: ['price_1TvLAYE1z3Q3TJr75nUKShmA', 'price_1TvLAYE1z3Q3TJr7wWkolH81'],
    tap_annual: ['price_1TvLBDE1z3Q3TJr7phXReAYV', 'price_1TvLBTE1z3Q3TJr7OsvIJpIl'],
    cellar_monthly: ['price_1TvLGLE1z3Q3TJr7YnDHhGvV', 'price_1TvLGLE1z3Q3TJr78UwUuxey'],
    cellar_annual: ['price_1TvLGLE1z3Q3TJr7vxpuPkCg', 'price_1TvLGLE1z3Q3TJr72N0WNs35'],
    reserve_monthly: ['price_1TvLHUE1z3Q3TJr7TvLH9Pzy', 'price_1TvLHoE1z3Q3TJr7IhJEVH3p'],
    reserve_annual: ['price_1TvLHUE1z3Q3TJr74Yy3IYDv', 'price_1TvLIFE1z3Q3TJr7RDc8OiY9'],
    kit: 'price_1UGMG5E1z3Q3TJr7TWJ3xl7O',
    extras: ['price_1UB1RDE1z3Q3TJr7c8OtrkGS', 'price_1TeSPoE1z3Q3TJr7VkofNbJG'],
  },
};

export const SESSION_ID = /^cs_(live|test)_[A-Za-z0-9]{20,240}$/;
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
const idOf = value => typeof value === 'string' ? value : value?.id;

export function checkoutSummary(session, sessionId, live) {
  const metadata = session?.metadata || {};
  const { dpc_circle: circle, dpc_billing_interval: billingInterval, dpc_offer_type: offer } = metadata;
  if (!['tap', 'cellar', 'reserve'].includes(circle)
    || !['monthly', 'annual'].includes(billingInterval)
    || !['standard', 'founding'].includes(offer)
    || !UUID.test(metadata.dpc_checkout_intent_id || '')
    || !UUID.test(metadata.dpc_member_id || '')
    || session.client_reference_id !== metadata.dpc_checkout_intent_id
    || session.id !== sessionId || session.object !== 'checkout.session'
    || session.mode !== 'subscription' || session.livemode !== live
    || session.currency !== 'usd') return null;

  const catalog = CATALOG[live ? 'live' : 'test'];
  const recurring = catalog[circle + '_' + billingInterval][offer === 'standard' ? 0 : 1];
  const items = session.line_items;
  if (!items || items.has_more !== false || !Array.isArray(items.data)
    || items.data.length < 1 || items.data.length > 3) return null;
  const prices = items.data.map(item => item?.price?.id);
  if (prices.filter(price => price === recurring).length !== 1
    || new Set(prices).size !== prices.length
    || items.data.some(item => item.quantity !== 1 || item.price?.currency !== 'usd'
      || ![recurring, catalog.kit, ...catalog.extras].includes(item.price?.id))) return null;

  if (session.status !== 'complete' || session.payment_status !== 'paid') return { status: 'pending' };
  // Invoice amount_paid reflects what was paid after customer balance/discounts,
  // unlike the catalog price or Checkout's pre-balance total. The initial invoice
  // must belong to this subscription; never report a subsequent renewal invoice.
  const invoice = session.invoice;
  if (!invoice || invoice.object !== 'invoice' || invoice.status !== 'paid'
    || invoice.livemode !== live || invoice.currency !== 'usd'
    || invoice.billing_reason !== 'subscription_create'
    || !/^sub_[A-Za-z0-9]+$/.test(idOf(session.subscription) || '')
    || idOf(invoice.subscription) !== idOf(session.subscription)
    || !Number.isSafeInteger(invoice.amount_paid) || invoice.amount_paid < 0
    || invoice.amount_paid > 99_999_999) return null;

  return {
    status: 'paid', circle, billingInterval, amountPaid: invoice.amount_paid,
    currency: 'usd', welcomeKit: prices.includes(catalog.kit), livemode: live,
  };
}
