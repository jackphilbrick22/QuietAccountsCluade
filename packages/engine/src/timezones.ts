/**
 * Time zones for US and Canadian shops: the console's list, and a first guess from a cell's area code (a sign-up
 * gives us only the cell). An area code in a split state gets the zone most of it keeps; the operator confirms.
 */
export const TIMEZONES: [zone: string, label: string][] = [
  ["America/New_York", "Eastern"],
  ["America/Chicago", "Central"],
  ["America/Denver", "Mountain"],
  ["America/Phoenix", "Arizona"],
  ["America/Los_Angeles", "Pacific"],
  ["America/Anchorage", "Alaska"],
  ["Pacific/Honolulu", "Hawaii"],
  ["America/Halifax", "Atlantic"],
  ["America/St_Johns", "Newfoundland"],
  ["America/Regina", "Saskatchewan"],
];

/** NANP area codes by the zone they keep (Canada's under the US zone with the same clock). */
const AREA_CODES: Record<string, string> = {
  "America/New_York":
    "201 202 203 207 212 215 216 220 223 226 227 229 231 234 239 240 248 249 252 260 263 267 269 272 276 289 301 302 304 305 313 315 317 321 326 330 332 336 339 343 347 351 352 354 365 367 380 382 386 401 404 407 410 412 413 416 418 419 423 434 437 438 440 443 445 450 463 468 470 475 478 484 502 508 513 514 516 517 518 519 540 548 551 561 567 570 571 574 579 581 582 585 586 603 606 607 609 610 613 614 616 617 631 640 645 646 647 656 667 678 679 680 681 683 689 703 704 705 706 716 717 718 724 727 732 734 740 742 743 754 757 762 765 770 771 772 774 781 786 802 803 804 807 810 812 813 814 819 826 828 835 838 839 843 845 848 854 856 857 859 860 862 863 864 865 873 878 904 905 906 908 910 912 914 917 919 929 930 934 937 941 942 943 947 948 954 959 973 978 980 984 989",
  "America/Chicago":
    "204 205 210 214 217 218 219 224 225 228 251 254 256 262 270 274 281 308 309 312 314 316 318 319 320 325 327 331 334 337 346 361 364 402 405 409 414 417 430 431 432 447 448 464 469 479 501 504 507 512 515 531 534 539 557 563 572 573 580 584 601 605 608 612 615 618 620 629 630 636 641 651 659 660 662 682 701 708 712 713 715 726 730 731 737 763 769 773 779 785 806 815 816 817 830 832 847 850 870 872 901 903 913 918 920 931 936 938 940 945 952 956 972 979 985",
  "America/Denver": "208 303 307 368 385 403 406 435 505 575 587 719 720 780 801 825 915 970 983 986",
  "America/Phoenix": "480 520 602 623 928",
  "America/Los_Angeles": "206 209 213 236 250 253 257 279 310 323 341 350 360 408 415 424 425 442 458 503 509 510 530 541 559 562 564 604 619 626 628 650 657 661 669 672 702 707 714 725 747 760 775 778 805 818 820 831 840 858 909 916 925 949 951 971",
  "America/Anchorage": "907",
  "Pacific/Honolulu": "808",
  "America/Halifax": "428 506 782 902",
  "America/St_Johns": "709 879",
  "America/Regina": "306 474 639",
};

const ZONE_OF = new Map(Object.entries(AREA_CODES).flatMap(([zone, codes]) => codes.split(" ").map((code) => [code, zone] as const)));

/** The zone a +1 cell's area code keeps, or nothing for a code we don't know. */
export function zoneForCell(e164: string): string | undefined {
  const code = /^\+1(\d{3})\d{7}$/.exec(e164)?.[1];
  return code ? ZONE_OF.get(code) : undefined;
}

/** A time zone this runtime knows ("America/Chicago"); anything else would stop the account's clock. */
export function isTimeZone(zone: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: zone });
    return true;
  } catch {
    return false;
  }
}
