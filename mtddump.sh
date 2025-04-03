#!/bin/sh
mtddump() {
    mtd=$1
    if [ -z "$mtd" ]; then
        echo "Usage: mtddump <mtd_device>"
        return
    fi
    cat /proc/mtd | grep "$mtd" || {
        echo "Error: MTD device $mtd not found in /proc/mtd."
        return
    }
    block_sz=$(printf "%d" $(cat /proc/mtd | grep "$mtd" | awk '{print "0x"$3}'))
    limit=$(($(printf "%d" $(cat /proc/mtd | grep "$mtd" | awk '{print "0x"$2}')) / $block_sz))
    i=0
    while [ $i -lt $limit ]; do
        rm ./mtd.bin ./mtd.bin.gz 2>/dev/null
        echo "READ $i"
        dd if=/dev/$mtd of=./mtd.bin bs=$block_sz count=1 skip=$i
        echo "SHA256 $i $(sha256sum ./mtd.bin)"
        gzip -9 ./mtd.bin
        hexdump -C -v ./mtd.bin.gz
        i=$((i+1))
    done
}