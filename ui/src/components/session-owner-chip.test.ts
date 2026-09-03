/* @vitest-environment jsdom */

import { afterEach, expect, it, vi } from "vitest";
import type { SessionParticipant } from "../../../packages/gateway-protocol/src/schema/session-participant.js";
import { setAvatarGatewayOrigin } from "../lib/identity-avatar-context.ts";
import { listAssignableSessionOwners, resolveAssignableOwnerFacet } from "./session-owner-chip.ts";

afterEach(() => {
  document.body.replaceChildren();
  setAvatarGatewayOrigin(null);
  vi.restoreAllMocks();
});

async function waitForChipUpdate(chip: HTMLElementTagNameMap["openclaw-session-owner-chip"]) {
  await chip.updateComplete;
  // The parent's update does not include the nested avatar's render.
  await Promise.all(
    [...chip.querySelectorAll("openclaw-viewer-avatar")].map((avatar) => avatar.updateComplete),
  );
}

async function mount(params: { participants?: SessionParticipant[]; participantCount?: number }) {
  const chip = document.createElement("openclaw-session-owner-chip");
  chip.owner = { type: "human", id: "profile-ada", label: "Ada" };
  chip.attribution = "owned";
  chip.size = "row";
  chip.participants = params.participants ?? [];
  chip.participantCount = params.participantCount ?? chip.participants.length;
  document.body.append(chip);
  await waitForChipUpdate(chip);
  expect(chip.querySelector(".session-owner-chip")).not.toBeNull();
  return chip;
}

it("keeps the single owner chip unchanged without participants", async () => {
  const chip = await mount({});
  expect(chip.querySelector(".session-owner-stack")).toBeNull();
  expect(chip.querySelectorAll(".session-owner-chip")).toHaveLength(1);
  expect(chip.querySelector(".session-owner-chip")?.getAttribute("aria-label")).toBe(
    "Owned by Ada",
  );
});

it("renders one participant behind the owner with combined accessibility", async () => {
  const chip = await mount({
    participants: [
      {
        identity: { type: "agent", id: "research" },
        label: "Research",
        avatarUrl: "/avatar/research",
      },
    ],
    participantCount: 1,
  });
  expect(chip.querySelector(".session-owner-stack__back .viewer-avatar")).not.toBeNull();
  expect(chip.querySelector(".session-owner-stack__front")).not.toBeNull();
  expect(chip.querySelector(".session-owner-stack")?.getAttribute("aria-label")).toBe(
    "Owned by Ada · with Research",
  );
  expect(chip.querySelector(".session-owner-stack__back img")?.getAttribute("src")).toBe(
    "/avatar/research",
  );
});

it.each(["row", "header"] as const)(
  "renders the configured agent picture in a %s owner chip",
  async (size) => {
    const chip = await mount({});
    chip.owner = {
      type: "agent",
      id: "research",
      identity: { type: "agent", id: "research" },
      label: "Research",
      avatarUrl: "/avatar/research",
    };
    chip.size = size;
    await waitForChipUpdate(chip);
    expect(chip.querySelector(".session-owner-chip img")?.getAttribute("src")).toBe(
      "/avatar/research",
    );
  },
);

it("renders the total participant count in the back slot for three identities", async () => {
  const chip = await mount({
    participants: [
      { identity: { type: "profile", id: "profile-bob" }, label: "Bob" },
      { identity: { type: "agent", id: "research" }, label: "Research" },
    ],
    participantCount: 2,
  });
  expect(chip.querySelector(".session-owner-stack__overflow")?.textContent).toBe("+2");
  expect(chip.querySelector(".session-owner-stack")?.getAttribute("aria-label")).toBe(
    "Owned by Ada · +2 more",
  );
});

it("treats a present owner facet as authoritative before adding self and configured agents", () => {
  const facet = [
    { type: "human" as const, id: "profile:channel:opaque", label: "Opaque Person" },
    {
      type: "agent" as const,
      id: "facet-agent",
      label: "Facet Agent",
      avatarUrl: "/avatar/facet-agent",
    },
    { type: "agent" as const, id: "avatar-only", avatarUrl: "/avatar/avatar-only" },
  ];

  expect(
    listAssignableSessionOwners({
      facet,
      agents: [
        { id: "configured-agent", name: "Configured Agent" },
        { id: "facet-agent", name: "Configured name" },
        { id: "avatar-only", name: "Avatar Only" },
      ],
      self: { id: "profile-self", name: "Self" },
    }),
  ).toEqual([
    {
      type: "agent",
      id: "avatar-only",
      identity: { type: "agent", id: "avatar-only" },
      label: "Avatar Only",
      avatarUrl: "/avatar/avatar-only",
    },
    {
      type: "agent",
      id: "configured-agent",
      identity: { type: "agent", id: "configured-agent" },
      label: "Configured Agent",
    },
    {
      type: "agent",
      id: "facet-agent",
      identity: { type: "agent", id: "facet-agent" },
      label: "Facet Agent",
      avatarUrl: "/avatar/facet-agent",
    },
    { type: "human", id: "profile:channel:opaque", label: "Opaque Person" },
    {
      type: "human",
      id: "profile-self",
      identity: { type: "profile", id: "profile-self" },
      label: "Self",
    },
  ]);
});

it("offers a resolved owner facet to a conversation that no loaded list contains", () => {
  // An archived conversation opened by its direct URL while the sidebar lists
  // active sessions is displayed outside every loaded list. The facet is the
  // Gateway's owner inventory for the query, not the owners of the returned
  // rows, so it still answers who can be assigned.
  const sidebarList = {
    owners: [
      { type: "human" as const, id: "profile-ada", label: "Ada" },
      { type: "human" as const, id: "profile-bob", label: "Bob" },
    ],
  };

  expect(resolveAssignableOwnerFacet([sidebarList, undefined])).toEqual([
    { type: "human", id: "profile-ada", label: "Ada" },
    { type: "human", id: "profile-bob", label: "Bob" },
  ]);
});

it("unions owner facets across lists and keeps the first identity for a shared id", () => {
  expect(
    resolveAssignableOwnerFacet([
      { owners: [{ type: "human", id: "profile-ada", label: "Ada" }] },
      {
        owners: [
          { type: "human", id: "profile-ada" },
          { type: "human", id: "profile-carol", label: "Carol" },
        ],
      },
    ]),
  ).toEqual([
    { type: "human", id: "profile-ada", label: "Ada" },
    { type: "human", id: "profile-carol", label: "Carol" },
  ]);
});

it("keeps the agent identity when two lists disagree about an id's owner type", () => {
  // Merging lists is what makes this collision reachable at all: a single facet
  // cannot report one id twice. Downstream, both the self-overwrite guard and
  // the configured-agent enrichment key off type === "agent", so demoting an
  // agent to a human here would let "me" overwrite a configured agent's entry.
  const merged = resolveAssignableOwnerFacet([
    { owners: [{ type: "human", id: "shared-id", label: "Human first" }] },
    { owners: [{ type: "agent", id: "shared-id", label: "Agent second" }] },
  ]);
  expect(merged).toEqual([{ type: "agent", id: "shared-id", label: "Agent second" }]);

  // The reverse order keeps the agent too, and an agent is never demoted.
  expect(
    resolveAssignableOwnerFacet([
      { owners: [{ type: "agent", id: "shared-id", label: "Agent first" }] },
      { owners: [{ type: "human", id: "shared-id", label: "Human second" }] },
    ]),
  ).toEqual([{ type: "agent", id: "shared-id", label: "Agent first" }]);

  // And the guard downstream still holds: self does not overwrite that entry.
  expect(
    listAssignableSessionOwners({ facet: merged, self: { id: "shared-id", name: "Me" } }),
  ).toEqual([{ type: "agent", id: "shared-id", label: "Agent second" }]);
});

it("reports an unresolved owner facet while every list is still hydrating", () => {
  // Distinct from an empty facet: callers read undefined as "not loaded yet",
  // and an empty array as "the Gateway disclosed nobody".
  expect(resolveAssignableOwnerFacet([undefined, {}])).toBeUndefined();
  expect(resolveAssignableOwnerFacet([{ owners: [] }, undefined])).toEqual([]);
});

it("does not reconstruct assignment candidates when the owner facet is absent", () => {
  expect(
    listAssignableSessionOwners({
      facet: undefined,
    }),
  ).toEqual([]);
});
