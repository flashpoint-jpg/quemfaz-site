import forge from "npm:node-forge@1.3.1";
export function p12ToPem(base64:string){
  const der = forge.util.decode64(base64.replace(/\s+/g,""));
  const asn1 = forge.asn1.fromDer(der);
  let p12:any = null;
  let last:any = null;
  for(const password of ["", undefined as any]){
    try { p12 = forge.pkcs12.pkcs12FromAsn1(asn1,false,password); break; }
    catch(e){ last=e; }
  }
  if(!p12) throw last || new Error("p12_parse_failed");
  const certOid = forge.pki.oids.certBag;
  const shroudedOid = forge.pki.oids.pkcs8ShroudedKeyBag;
  const keyOid = forge.pki.oids.keyBag;
  const certs = p12.getBags({bagType:certOid})[certOid] || [];
  const shrouded = p12.getBags({bagType:shroudedOid})[shroudedOid] || [];
  const plain = p12.getBags({bagType:keyOid})[keyOid] || [];
  const certBag = certs.find((b:any)=>b.cert) || certs[0];
  const keyBag = shrouded.find((b:any)=>b.key) || plain.find((b:any)=>b.key) || shrouded[0] || plain[0];
  if(!certBag?.cert || !keyBag?.key) throw new Error("p12_key_or_cert_missing");
  return {cert:forge.pki.certificateToPem(certBag.cert),key:forge.pki.privateKeyToPem(keyBag.key)};
}

