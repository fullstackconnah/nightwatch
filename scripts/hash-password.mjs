import bcrypt from "bcryptjs";

const pw = process.argv[2];
if (!pw) {
  console.error("usage: npm run hash-password -- '<password>'");
  process.exit(1);
}
console.log(bcrypt.hashSync(pw, 12));
