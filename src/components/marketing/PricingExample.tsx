import pricingExample from "@/content/marketing/homepage-example.json";

const money = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: pricingExample.currency,
  minimumFractionDigits: 0,
  maximumFractionDigits: 2,
});
const savingsCents = pricingExample.soloMonthlyCents - pricingExample.groupMonthlyCents;
const savingsPercent = Math.round(savingsCents / pricingExample.soloMonthlyCents * 100);

export function PricingExample() {
  return (
    <div className="hero-example" aria-labelledby="pricing-example-title">
      <p className="example-label" id="pricing-example-title">Example · {pricingExample.service}</p>
      <dl className="example-prices">
        <div>
          <dt>On your own</dt>
          <dd><strong>{money.format(pricingExample.soloMonthlyCents / 100)}</strong><span> /month per home</span></dd>
        </div>
        <div>
          <dt>With {pricingExample.participatingHomes} homes</dt>
          <dd><strong>{money.format(pricingExample.groupMonthlyCents / 100)}</strong><span> /month per home</span></dd>
        </div>
      </dl>
      <p className="example-savings">
        Save {money.format(savingsCents / 100)}/month per home — about {savingsPercent}% in this example.
      </p>
      <p className="example-request">
        Illustrative request: {pricingExample.participatingHomes} homes joined · {pricingExample.providerBids} competing provider bids.
      </p>
      <p className="example-note">Example pricing. Your community’s price is set by real provider bids.</p>
    </div>
  );
}
