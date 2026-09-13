import { test } from "node:test";
import assert from "node:assert/strict";
import { classifyLocation, isIndia, shortLocation } from "../src/shared/india.ts";
import { roleFamily } from "../src/shared/roles.ts";
import { formatAmount, formatUsdTotal } from "../src/shared/money.ts";

test("locations", () => {
  assert.equal(classifyLocation("Head Office, Bengaluru, Karnataka\r, India"), "india");
  assert.equal(classifyLocation("Bangalore, KA"), "india");
  assert.equal(classifyLocation("Remote - India"), "india");
  assert.equal(classifyLocation("Remote"), "remote");
  assert.equal(classifyLocation("San Francisco, CA"), "abroad");
  assert.equal(classifyLocation("Remote (US)"), "abroad");
  assert.equal(classifyLocation("London, UK"), "abroad");
  assert.equal(classifyLocation("Singapore"), "abroad");
  assert.equal(classifyLocation("IN"), "india");
  assert.equal(classifyLocation(""), "unknown");
  assert.equal(isIndia("Gurgaon/Remote"), true);
  assert.equal(isIndia("New York"), false);
  // "Indiana" must not read as India.
  assert.equal(classifyLocation("Indianapolis, Indiana"), "unknown");
  assert.equal(shortLocation("Head Office, Bengaluru, Karnataka\r, India"), "Bengaluru");
  assert.equal(shortLocation("Gurgaon, Haryana"), "Gurugram");
  assert.equal(shortLocation("Remote - India"), "Remote");
});

test("role families", () => {
  assert.equal(roleFamily("Software Development Engineer III"), "Engineering");
  assert.equal(roleFamily("Data Engineer"), "Data & AI");
  assert.equal(roleFamily("Senior Product Designer"), "Design");
  assert.equal(roleFamily("Product Manager"), "Product");
  assert.equal(roleFamily("Sales Engineer"), "Sales");
  assert.equal(roleFamily("Performance Marketing Manager"), "Marketing");
  assert.equal(roleFamily("Business Associate"), "Operations");
  assert.equal(roleFamily("Assistant Manager - Finance"), "Finance & Legal");
  assert.equal(roleFamily("Talent Acquisition Partner"), "People");
  assert.equal(roleFamily("Customer Success Manager"), "Customer");
  assert.equal(roleFamily("Spacecraft Controller"), "Other");
  assert.equal(roleFamily("Machine Learning Engineer"), "Data & AI");
  assert.equal(roleFamily("Product Manager On-Device & Edge AI"), "Product");
  assert.equal(roleFamily("GTM Manager On-Device AI"), "Sales");
  assert.equal(roleFamily("Growth Marketing Lead"), "Marketing");
  assert.equal(roleFamily("Staff Data Engineer"), "Data & AI");
});

test("money formatting", () => {
  assert.equal(formatAmount(24e6, "USD"), "$24M");
  assert.equal(formatAmount(1.5e6, "USD"), "$1.5M");
  assert.equal(formatAmount(1.2e9, "USD"), "$1.2B");
  assert.equal(formatAmount(532e7, "INR"), "₹532 Cr");
  assert.equal(formatAmount(1.7e7, "INR"), "₹1.7 Cr");
  assert.equal(formatAmount(50e5, "INR"), "₹50 L");
  assert.equal(formatAmount(4.3e6, "EUR"), "€4.3M");
  assert.equal(formatAmount(null, null), "Undisclosed");
  assert.equal(formatUsdTotal(1.23e9), "$1.23B");
  assert.equal(formatUsdTotal(840.4e6), "$840M");
});
