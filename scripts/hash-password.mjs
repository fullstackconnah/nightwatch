import bcrypt from "bcryptjs";

const pw = process.argv[2];
if (!pw) {
  console.error("usage: npm run hash-password -- '<password>'");
  process.exit(1);
}
if (Buffer.byteLength(pw) > 72) {
  console.error("Password is too long: the most is 72 bytes");
  process.exit(1);
}
console.log(bcrypt.hashSync(pw, 12));
