import { describe, expect, it } from "vitest";
import { boardCommentSchema, boardOpenSchema, boardPolicySchema, boardVoteSchema } from "@/lib/validation/board";

describe("board request validation", () => {
  it.each([0,-1,1.5,101,NaN])("rejects invalid N approval thresholds %s", quorumN => {
    expect(boardPolicySchema.safeParse({rule:"board_quorum_n",quorumN,expectedVersion:0}).success).toBe(false);
  });
  it("requires N only for the explicit N-approvals policy", () => {
    expect(boardPolicySchema.safeParse({rule:"board_quorum_n",expectedVersion:0}).success).toBe(false);
    for(const rule of ["manager_only","board_majority","board_unanimous"]) {
      expect(boardPolicySchema.safeParse({rule,quorumN:2,expectedVersion:0}).success).toBe(false);
      expect(boardPolicySchema.safeParse({rule,quorumN:null,expectedVersion:0}).success).toBe(true);
    }
    expect(boardPolicySchema.parse({rule:"board_quorum_n",quorumN:2,expectedVersion:1})).toMatchObject({quorumN:2});
  });
  it("requires optimistic policy version and forbids client-authored authority", () => {
    expect(boardPolicySchema.safeParse({rule:"manager_only"}).success).toBe(false);
    expect(boardPolicySchema.safeParse({rule:"manager_only",expectedVersion:-1}).success).toBe(false);
    expect(boardPolicySchema.safeParse({rule:"manager_only",expectedVersion:0,actorUserId:"admin"}).success).toBe(false);
  });
  it("requires unique, bounded shortlist IDs and timezone-explicit deadlines", () => {
    const base={bidIds:["bid-a"],deadline:"2028-01-31T12:00:00.000Z"};
    expect(boardOpenSchema.safeParse(base).success).toBe(true);
    for(const bidIds of [[],["bid-a","bid-a"],Array.from({length:21},(_,i)=>`bid-${i}`),[""]]) {
      expect(boardOpenSchema.safeParse({...base,bidIds}).success).toBe(false);
    }
    expect(boardOpenSchema.safeParse({...base,deadline:"2028-01-31T12:00:00"}).success).toBe(false);
    expect(boardOpenSchema.safeParse({...base,electorate:["my-user"]}).success).toBe(false);
  });
  it("accepts explicit approve or reject only, never forged voter identity", () => {
    for(const decision of ["approve","reject"]) expect(boardVoteSchema.safeParse({bidId:"bid-a",decision,comment:"  because  "}).success).toBe(true);
    for(const decision of ["abstain","yes",true,null]) expect(boardVoteSchema.safeParse({bidId:"bid-a",decision}).success).toBe(false);
    expect(boardVoteSchema.safeParse({bidId:"bid-a",decision:"approve",voterUserId:"another-member"}).success).toBe(false);
    expect(boardVoteSchema.safeParse({bidId:"bid-a",decision:"approve",comment:"x".repeat(2001)}).success).toBe(false);
  });
  it("trims private discussion text, refuses empty bodies and bounds stored text", () => {
    expect(boardCommentSchema.parse({body:"  Measurable comparison  "})).toEqual({body:"Measurable comparison"});
    for(const body of ["","   ","x".repeat(4001)]) expect(boardCommentSchema.safeParse({body}).success).toBe(false);
    expect(boardCommentSchema.safeParse({body:"Reason",authorUserId:"spoof"}).success).toBe(false);
  });
});
