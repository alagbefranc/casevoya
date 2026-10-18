import { describe, expect, it } from "vitest";
import { MIGRATION_MAX_ROWS, readMigrationFile, rowHash, rowsDigest, sha256Hex } from "@/modules/migration/csv";
import {
  guessDateOrder,
  migrationError,
  needsMigrationStepUp,
  rowResult,
  shortHash,
  suggestColumns,
  suggestValue,
  valueKey,
} from "@/modules/sheet/migration-present";

/** Migration import (T044): server-side file reading with limits, checksums, and the page's words. Synthetic data only. */

const encode = (text: string) => new TextEncoder().encode(text);

describe("reading a migration file", () => {
  it("parses a CSV with quoted fields and returns its checksum and row digest", async () => {
    const text = 'Full Name,DOB,Email\r\n"Sharma, Priya",09/03/1984,priya@example.test\r\nRafael Sharma,21/11/1981,\r\n';
    const read = await readMigrationFile(encode(text));
    if ("error" in read) throw new Error(read.error);
    expect(read.headers).toEqual(["Full Name", "DOB", "Email"]);
    expect(read.rows).toEqual([
      ["Sharma, Priya", "09/03/1984", "priya@example.test"],
      ["Rafael Sharma", "21/11/1981", ""],
    ]);
    expect(read.sha256).toBe(await sha256Hex(encode(text)));
    expect(read.digest).toBe(await rowsDigest(read.rows));
    expect(read.bytes).toBe(encode(text).byteLength);
    // Row hashes join cells with the unit separator, as the database does.
    expect(await rowHash(["a", "b"])).toBe(await sha256Hex("a\u001fb"));
  });

  it("refuses files over 5 MB or 5,000 rows, non-UTF-8 text, and rows wider than the header", async () => {
    expect(await readMigrationFile(new Uint8Array(5 * 1024 * 1024 + 1))).toEqual({ error: "The file is larger than 5 MB. Split it and import each part." });
    const many = ["Name", ...Array.from({ length: MIGRATION_MAX_ROWS + 1 }, (_, index) => `Person ${index}`)].join("\n");
    expect(await readMigrationFile(encode(many))).toEqual({ error: "The file has 5,001 rows. Import up to 5,000 at a time." });
    const exact = ["Name", ...Array.from({ length: MIGRATION_MAX_ROWS }, (_, index) => `Person ${index}`)].join("\n");
    expect("error" in (await readMigrationFile(encode(exact)))).toBe(false);
    expect(await readMigrationFile(new Uint8Array([0x4e, 0x61, 0xff, 0x0a, 0x41]))).toEqual({ error: "Save the file as CSV in UTF-8 and try again." });
    expect(await readMigrationFile(encode("Name\nA,extra"))).toEqual({ error: "Row 2 has more values than there are column headings." });
    expect(await readMigrationFile(encode("Name\n"))).toEqual({ error: "The file needs a header row and at least one row of data." });
    expect(await readMigrationFile(encode(`Name\n${"x".repeat(4001)}`))).toEqual({ error: "Row 2 has a value longer than 4,000 characters." });
    expect(await readMigrationFile(new Uint8Array())).toEqual({ error: "The file is empty." });
  });
});

describe("mapping suggestions", () => {
  it("suggests fields from common headings, using each column once", () => {
    expect(suggestColumns(["Full Name", "DOB", "Email", "File #", "Status", "Program", "Consultant", "Role", "Case manager", "Mobile"])).toEqual({
      name: 0,
      date_of_birth: 1,
      email: 2,
      reference: 3,
      stage: 4,
      program: 5,
      consultant: 6,
      role: 7,
      case_manager: 8,
      phone: 9,
    });
    expect(suggestColumns(["Notes", "Comments"])).toEqual({});
  });

  it("reads the date order from the dates, and is unsure when every date is ambiguous", () => {
    expect(guessDateOrder(["09/03/1984", "21/11/1981"])).toEqual({ order: "dmy", certain: true });
    expect(guessDateOrder(["03/09/1984", "11/21/1981"])).toEqual({ order: "mdy", certain: true });
    expect(guessDateOrder(["1984-03-09", ""])).toEqual({ order: "ymd", certain: true });
    expect(guessDateOrder(["01/02/1990"])).toEqual({ order: "dmy", certain: false });
  });

  it("maps a value only when it is exactly a configured value; anything else stays for a person", () => {
    const programs = [{ value: "pack-1", label: "Express entry" }];
    expect(suggestValue("program", valueKey("  Express   Entry "), programs)).toBe("pack-1");
    expect(suggestValue("program", valueKey("Express Entry (FSW)"), programs)).toBeNull();
    expect(suggestValue("stage", "intake", [{ value: "intake", label: "Intake" }])).toBe("intake");
    expect(suggestValue("stage", "active", [{ value: "intake", label: "Intake" }])).toBeNull();
    expect(suggestValue("role", "sponsor", [])).toBe("sponsor");
    expect(suggestValue("role", "spouse", [])).toBeNull();
  });
});

describe("migration words", () => {
  it("names each row's result and the file's hash", () => {
    expect(rowResult("create", null)).toEqual({ tone: "ok", label: "New person" });
    expect(rowResult("link", "person")).toEqual({ tone: "ok", label: "Matches existing", detail: "linked" });
    expect(rowResult("confirm", null)).toEqual({ tone: "chg", label: "Possible match", detail: "confirm" });
    expect(rowResult("review", null).label).toBe("Needs review");
    expect(rowResult("skip", null).label).toBe("Not imported");
    expect(shortHash("51c0aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaae2")).toBe("hash 51c0…e2");
  });

  it("never passes a database message through", () => {
    expect(migrationError("firm owner step-up is required")).toBe("Confirm it’s you with your authenticator, then try again.");
    expect(needsMigrationStepUp("firm owner step-up is required")).toBe(true);
    expect(migrationError("staff access denied")).toBe("Only the firm owner can import records.");
    expect(migrationError("migration row 14: the matter was refused (licence)")).toMatch(/^Row 14: a licence blocks/);
    expect(migrationError("decide every possible match first")).toBe("Decide every possible match on Preview first.");
    expect(migrationError('relation "public.migration_rows" does not exist')).toBe("That action could not be completed.");
  });
});
