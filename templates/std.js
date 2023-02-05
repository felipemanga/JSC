export const std = `$[[minStringTable]]

#define PRINT(str) printf("%s", str)
#define PRINTLN() printf("\\n");
#define STRDECL(VAR, LEN, STR) __attribute__ ((aligned)) const std::array<uint8_t, sizeof(js::Buffer) + LEN> VAR = js::bufferFrom<LEN>(STR);

#include "js.hpp"

$[[translated]]

int main() {
  {
    js::Local args = js::arguments(0);
    $[[main]](args, false);
  }
  js::gc();
  return 0;
}`;
