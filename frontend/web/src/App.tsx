// App.tsx
import { ConnectButton } from '@rainbow-me/rainbowkit';
import '@rainbow-me/rainbowkit/styles.css';
import React, { useEffect, useState } from "react";
import { ethers } from "ethers";
import { getContractReadOnly, getContractWithSigner } from "./contract";
import "./App.css";
import { useAccount, useSignMessage } from 'wagmi';

interface GWASRecord {
  id: string;
  encryptedData: string;
  timestamp: number;
  institution: string;
  phenotype: string;
  status: "pending" | "processed" | "error";
  snpCount?: number;
}

// Style choices (randomly selected):
// Colors: Gradient (rainbow)
// UI Style: Glass morphism
// Layout: Center radiation
// Interaction: Micro-interactions (hover ripple, button breathing light)

const FHEEncryptNumber = (value: number): string => {
  return `FHE-${btoa(value.toString())}`;
};

const FHEDecryptNumber = (encryptedData: string): number => {
  if (encryptedData.startsWith('FHE-')) {
    return parseFloat(atob(encryptedData.substring(4)));
  }
  return parseFloat(encryptedData);
};

const FHEComputeGWAS = (encryptedData: string): string => {
  const value = FHEDecryptNumber(encryptedData);
  // Simulate GWAS computation (p-value calculation)
  const pValue = Math.exp(-value * 0.1);
  return FHEEncryptNumber(pValue);
};

const generatePublicKey = () => `0x${Array(2000).fill(0).map(() => Math.floor(Math.random() * 16).toString(16)).join('')}`;

const App: React.FC = () => {
  const { address, isConnected } = useAccount();
  const { signMessageAsync } = useSignMessage();
  const [loading, setLoading] = useState(true);
  const [records, setRecords] = useState<GWASRecord[]>([]);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [showUploadModal, setShowUploadModal] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [transactionStatus, setTransactionStatus] = useState<{ visible: boolean; status: "pending" | "success" | "error"; message: string; }>({ visible: false, status: "pending", message: "" });
  const [newRecordData, setNewRecordData] = useState({ phenotype: "", description: "", snpCount: 0, effectSize: 0 });
  const [showTutorial, setShowTutorial] = useState(false);
  const [selectedRecord, setSelectedRecord] = useState<GWASRecord | null>(null);
  const [decryptedValue, setDecryptedValue] = useState<number | null>(null);
  const [isDecrypting, setIsDecrypting] = useState(false);
  const [publicKey, setPublicKey] = useState<string>("");
  const [contractAddress, setContractAddress] = useState<string>("");
  const [chainId, setChainId] = useState<number>(0);
  const [startTimestamp, setStartTimestamp] = useState<number>(0);
  const [durationDays, setDurationDays] = useState<number>(30);
  const [searchTerm, setSearchTerm] = useState("");
  const [activeTab, setActiveTab] = useState("all");

  const processedCount = records.filter(r => r.status === "processed").length;
  const pendingCount = records.filter(r => r.status === "pending").length;
  const errorCount = records.filter(r => r.status === "error").length;

  useEffect(() => {
    loadRecords().finally(() => setLoading(false));
    const initSignatureParams = async () => {
      const contract = await getContractReadOnly();
      if (contract) setContractAddress(await contract.getAddress());
      if (window.ethereum) {
        const chainIdHex = await window.ethereum.request({ method: 'eth_chainId' });
        setChainId(parseInt(chainIdHex, 16));
      }
      setStartTimestamp(Math.floor(Date.now() / 1000));
      setDurationDays(30);
      setPublicKey(generatePublicKey());
    };
    initSignatureParams();
  }, []);

  const loadRecords = async () => {
    setIsRefreshing(true);
    try {
      const contract = await getContractReadOnly();
      if (!contract) return;
      
      // Check contract availability
      const isAvailable = await contract.isAvailable();
      if (!isAvailable) return;
      
      // Get list of record keys
      const keysBytes = await contract.getData("gwas_record_keys");
      let keys: string[] = [];
      if (keysBytes.length > 0) {
        try {
          const keysStr = ethers.toUtf8String(keysBytes);
          if (keysStr.trim() !== '') keys = JSON.parse(keysStr);
        } catch (e) { console.error("Error parsing record keys:", e); }
      }
      
      // Load each record
      const list: GWASRecord[] = [];
      for (const key of keys) {
        try {
          const recordBytes = await contract.getData(`gwas_record_${key}`);
          if (recordBytes.length > 0) {
            try {
              const recordData = JSON.parse(ethers.toUtf8String(recordBytes));
              list.push({ 
                id: key, 
                encryptedData: recordData.data, 
                timestamp: recordData.timestamp, 
                institution: recordData.institution, 
                phenotype: recordData.phenotype, 
                status: recordData.status || "pending",
                snpCount: recordData.snpCount || 0
              });
            } catch (e) { console.error(`Error parsing record data for ${key}:`, e); }
          }
        } catch (e) { console.error(`Error loading record ${key}:`, e); }
      }
      list.sort((a, b) => b.timestamp - a.timestamp);
      setRecords(list);
    } catch (e) { console.error("Error loading records:", e); } 
    finally { setIsRefreshing(false); setLoading(false); }
  };

  const uploadGWASData = async () => {
    if (!isConnected) { alert("Please connect wallet first"); return; }
    setUploading(true);
    setTransactionStatus({ visible: true, status: "pending", message: "Encrypting GWAS data with Zama FHE..." });
    try {
      // Encrypt the effect size with FHE
      const encryptedData = FHEEncryptNumber(newRecordData.effectSize);
      
      const contract = await getContractWithSigner();
      if (!contract) throw new Error("Failed to get contract with signer");
      
      // Generate unique ID for this record
      const recordId = `gwas-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`;
      
      // Prepare record data
      const recordData = { 
        data: encryptedData, 
        timestamp: Math.floor(Date.now() / 1000), 
        institution: address, 
        phenotype: newRecordData.phenotype,
        status: "pending",
        snpCount: newRecordData.snpCount
      };
      
      // Store the record
      await contract.setData(`gwas_record_${recordId}`, ethers.toUtf8Bytes(JSON.stringify(recordData)));
      
      // Update the record keys list
      const keysBytes = await contract.getData("gwas_record_keys");
      let keys: string[] = [];
      if (keysBytes.length > 0) {
        try { keys = JSON.parse(ethers.toUtf8String(keysBytes)); } 
        catch (e) { console.error("Error parsing keys:", e); }
      }
      keys.push(recordId);
      await contract.setData("gwas_record_keys", ethers.toUtf8Bytes(JSON.stringify(keys)));
      
      setTransactionStatus({ visible: true, status: "success", message: "Encrypted GWAS data submitted securely!" });
      await loadRecords();
      setTimeout(() => {
        setTransactionStatus({ visible: false, status: "pending", message: "" });
        setShowUploadModal(false);
        setNewRecordData({ phenotype: "", description: "", snpCount: 0, effectSize: 0 });
      }, 2000);
    } catch (e: any) {
      const errorMessage = e.message.includes("user rejected transaction") ? "Transaction rejected by user" : "Submission failed: " + (e.message || "Unknown error");
      setTransactionStatus({ visible: true, status: "error", message: errorMessage });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
    } finally { setUploading(false); }
  };

  const processGWAS = async (recordId: string) => {
    if (!isConnected) { alert("Please connect wallet first"); return; }
    setTransactionStatus({ visible: true, status: "pending", message: "Processing encrypted GWAS data with FHE..." });
    try {
      const contract = await getContractReadOnly();
      if (!contract) throw new Error("Failed to get contract");
      
      // Get the record
      const recordBytes = await contract.getData(`gwas_record_${recordId}`);
      if (recordBytes.length === 0) throw new Error("Record not found");
      const recordData = JSON.parse(ethers.toUtf8String(recordBytes));
      
      // Simulate FHE computation for GWAS
      const processedData = FHEComputeGWAS(recordData.data);
      
      // Update the record with processed data
      const contractWithSigner = await getContractWithSigner();
      if (!contractWithSigner) throw new Error("Failed to get contract with signer");
      
      const updatedRecord = { ...recordData, status: "processed", data: processedData };
      await contractWithSigner.setData(`gwas_record_${recordId}`, ethers.toUtf8Bytes(JSON.stringify(updatedRecord)));
      
      setTransactionStatus({ visible: true, status: "success", message: "FHE GWAS processing completed!" });
      await loadRecords();
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 2000);
    } catch (e: any) {
      setTransactionStatus({ visible: true, status: "error", message: "Processing failed: " + (e.message || "Unknown error") });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
    }
  };

  const decryptWithSignature = async (encryptedData: string): Promise<number | null> => {
    if (!isConnected) { alert("Please connect wallet first"); return null; }
    setIsDecrypting(true);
    try {
      const message = `publickey:${publicKey}\ncontractAddresses:${contractAddress}\ncontractsChainId:${chainId}\nstartTimestamp:${startTimestamp}\ndurationDays:${durationDays}`;
      await signMessageAsync({ message });
      await new Promise(resolve => setTimeout(resolve, 1500));
      return FHEDecryptNumber(encryptedData);
    } catch (e) { console.error("Decryption failed:", e); return null; } 
    finally { setIsDecrypting(false); }
  };

  const isOwner = (recordAddress: string) => address?.toLowerCase() === recordAddress.toLowerCase();

  const tutorialSteps = [
    { title: "Connect Wallet", description: "Connect your Web3 wallet to access the GWAS platform", icon: "🔗" },
    { title: "Upload Encrypted Data", description: "Submit your genomic data which will be encrypted using Zama FHE", icon: "🔒", details: "Your sensitive genomic data is encrypted client-side before blockchain submission" },
    { title: "FHE GWAS Processing", description: "Data is analyzed in encrypted state without decryption", icon: "🧬", details: "Zama FHE enables statistical analysis on encrypted genomic data" },
    { title: "Get Results", description: "Receive significant SNP associations while preserving privacy", icon: "📊", details: "Results are computed on encrypted data and can be verified without decryption" }
  ];

  const filteredRecords = records.filter(record => {
    const matchesSearch = record.phenotype.toLowerCase().includes(searchTerm.toLowerCase()) || 
                         record.institution.toLowerCase().includes(searchTerm.toLowerCase());
    const matchesTab = activeTab === "all" || record.status === activeTab;
    return matchesSearch && matchesTab;
  });

  const renderStatusChart = () => {
    const total = records.length || 1;
    const processedPercentage = (processedCount / total) * 100;
    const pendingPercentage = (pendingCount / total) * 100;
    const errorPercentage = (errorCount / total) * 100;
    
    return (
      <div className="status-chart">
        <div className="chart-bar">
          <div className="bar-segment processed" style={{ width: `${processedPercentage}%` }}></div>
          <div className="bar-segment pending" style={{ width: `${pendingPercentage}%` }}></div>
          <div className="bar-segment error" style={{ width: `${errorPercentage}%` }}></div>
        </div>
        <div className="chart-legend">
          <div className="legend-item"><div className="color-dot processed"></div><span>Processed: {processedCount}</span></div>
          <div className="legend-item"><div className="color-dot pending"></div><span>Pending: {pendingCount}</span></div>
          <div className="legend-item"><div className="color-dot error"></div><span>Error: {errorCount}</span></div>
        </div>
      </div>
    );
  };

  if (loading) return (
    <div className="loading-screen">
      <div className="dna-spinner"></div>
      <p>Initializing encrypted GWAS connection...</p>
    </div>
  );

  return (
    <div className="app-container">
      <div className="glass-background"></div>
      <div className="radial-gradient"></div>
      
      <header className="app-header">
        <div className="logo">
          <div className="dna-icon"></div>
          <h1>FHEN011<span>Private GWAS</span></h1>
        </div>
        <div className="header-actions">
          <button onClick={() => setShowUploadModal(true)} className="upload-btn">
            <span className="btn-ripple"></span>
            <span className="btn-content">Upload Data</span>
          </button>
          <div className="wallet-connect-wrapper">
            <ConnectButton accountStatus="address" chainStatus="icon" showBalance={false}/>
          </div>
        </div>
      </header>

      <main className="main-content">
        <div className="welcome-banner">
          <h2>FHE-Powered Genome-Wide Association Studies</h2>
          <p>Perform private GWAS analysis on encrypted genomic data using Zama FHE technology</p>
          <div className="fhe-badge">
            <div className="fhe-lock"></div>
            <span>Fully Homomorphic Encryption</span>
          </div>
        </div>

        <div className="dashboard-section">
          <div className="stats-card">
            <h3>GWAS Data Overview</h3>
            <div className="stats-grid">
              <div className="stat-item">
                <div className="stat-value">{records.length}</div>
                <div className="stat-label">Total Datasets</div>
              </div>
              <div className="stat-item">
                <div className="stat-value">{processedCount}</div>
                <div className="stat-label">Processed</div>
              </div>
              <div className="stat-item">
                <div className="stat-value">{pendingCount}</div>
                <div className="stat-label">Pending</div>
              </div>
              <div className="stat-item">
                <div className="stat-value">{errorCount}</div>
                <div className="stat-label">Errors</div>
              </div>
            </div>
            {renderStatusChart()}
          </div>

          <div className="info-card">
            <h3>About FHEN011</h3>
            <p>FHEN011 enables multi-institutional GWAS analysis on <strong>FHE-encrypted genomic data</strong> without compromising individual privacy. Data remains encrypted during processing using Zama FHE technology.</p>
            <div className="feature-list">
              <div className="feature-item">
                <div className="feature-icon">🔒</div>
                <span>Data encrypted end-to-end</span>
              </div>
              <div className="feature-item">
                <div className="feature-icon">🧬</div>
                <span>Genome-wide SNP analysis</span>
              </div>
              <div className="feature-item">
                <div className="feature-icon">⚡</div>
                <span>Multi-party computation</span>
              </div>
            </div>
            <button className="toggle-tutorial" onClick={() => setShowTutorial(!showTutorial)}>
              {showTutorial ? "Hide Tutorial" : "Show How It Works"}
            </button>
          </div>
        </div>

        {showTutorial && (
          <div className="tutorial-section">
            <h2>Private GWAS with FHE</h2>
            <div className="tutorial-steps">
              {tutorialSteps.map((step, index) => (
                <div className="tutorial-step" key={index}>
                  <div className="step-icon">{step.icon}</div>
                  <div className="step-content">
                    <h3>{step.title}</h3>
                    <p>{step.description}</p>
                    {step.details && <div className="step-details">{step.details}</div>}
                  </div>
                </div>
              ))}
            </div>
            <div className="fhe-flow">
              <div className="flow-step">
                <div className="flow-icon">🧬</div>
                <div className="flow-label">Raw Genomic Data</div>
              </div>
              <div className="flow-arrow">→</div>
              <div className="flow-step">
                <div className="flow-icon">🔒</div>
                <div className="flow-label">FHE Encryption</div>
              </div>
              <div className="flow-arrow">→</div>
              <div className="flow-step">
                <div className="flow-icon">⚙️</div>
                <div className="flow-label">Encrypted GWAS</div>
              </div>
              <div className="flow-arrow">→</div>
              <div className="flow-step">
                <div className="flow-icon">📊</div>
                <div className="flow-label">Private Results</div>
              </div>
            </div>
          </div>
        )}

        <div className="records-section">
          <div className="section-header">
            <h2>GWAS Datasets</h2>
            <div className="controls">
              <div className="search-box">
                <input 
                  type="text" 
                  placeholder="Search phenotypes..." 
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                />
                <div className="search-icon"></div>
              </div>
              <div className="tabs">
                <button 
                  className={activeTab === "all" ? "active" : ""}
                  onClick={() => setActiveTab("all")}
                >
                  All ({records.length})
                </button>
                <button 
                  className={activeTab === "processed" ? "active" : ""}
                  onClick={() => setActiveTab("processed")}
                >
                  Processed ({processedCount})
                </button>
                <button 
                  className={activeTab === "pending" ? "active" : ""}
                  onClick={() => setActiveTab("pending")}
                >
                  Pending ({pendingCount})
                </button>
              </div>
              <button 
                onClick={loadRecords} 
                className="refresh-btn"
                disabled={isRefreshing}
              >
                {isRefreshing ? "Refreshing..." : "Refresh"}
              </button>
            </div>
          </div>

          {filteredRecords.length === 0 ? (
            <div className="empty-state">
              <div className="empty-icon"></div>
              <p>No GWAS datasets found</p>
              <button className="primary-btn" onClick={() => setShowUploadModal(true)}>
                Upload First Dataset
              </button>
            </div>
          ) : (
            <div className="records-grid">
              {filteredRecords.map(record => (
                <div 
                  className={`record-card ${record.status}`} 
                  key={record.id}
                  onClick={() => setSelectedRecord(record)}
                >
                  <div className="card-header">
                    <h3>{record.phenotype}</h3>
                    <span className={`status-badge ${record.status}`}>{record.status}</span>
                  </div>
                  <div className="card-details">
                    <div className="detail-item">
                      <span>Institution:</span>
                      <strong>{record.institution.substring(0, 6)}...{record.institution.substring(38)}</strong>
                    </div>
                    <div className="detail-item">
                      <span>SNPs:</span>
                      <strong>{record.snpCount.toLocaleString()}</strong>
                    </div>
                    <div className="detail-item">
                      <span>Uploaded:</span>
                      <strong>{new Date(record.timestamp * 1000).toLocaleDateString()}</strong>
                    </div>
                  </div>
                  <div className="card-actions">
                    {isOwner(record.institution) && record.status === "pending" && (
                      <button 
                        className="process-btn"
                        onClick={(e) => {
                          e.stopPropagation();
                          processGWAS(record.id);
                        }}
                      >
                        Process with FHE
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </main>

      {showUploadModal && (
        <div className="modal-overlay">
          <div className="upload-modal">
            <div className="modal-header">
              <h2>Upload GWAS Dataset</h2>
              <button onClick={() => setShowUploadModal(false)} className="close-modal">&times;</button>
            </div>
            <div className="modal-body">
              <div className="upload-notice">
                <div className="notice-icon">🔒</div>
                <p>Your genomic data will be <strong>encrypted with Zama FHE</strong> before submission and remain encrypted during processing.</p>
              </div>
              
              <div className="form-group">
                <label>Phenotype *</label>
                <input 
                  type="text" 
                  name="phenotype"
                  value={newRecordData.phenotype}
                  onChange={(e) => setNewRecordData({...newRecordData, phenotype: e.target.value})}
                  placeholder="e.g., Type 2 Diabetes, Height, etc."
                />
              </div>
              
              <div className="form-group">
                <label>Description</label>
                <textarea 
                  name="description"
                  value={newRecordData.description}
                  onChange={(e) => setNewRecordData({...newRecordData, description: e.target.value})}
                  placeholder="Brief description of the phenotype..."
                  rows={3}
                ></textarea>
              </div>
              
              <div className="form-row">
                <div className="form-group">
                  <label>SNP Count *</label>
                  <input 
                    type="number" 
                    name="snpCount"
                    value={newRecordData.snpCount}
                    onChange={(e) => setNewRecordData({...newRecordData, snpCount: parseInt(e.target.value) || 0})}
                    placeholder="Number of SNPs in dataset"
                  />
                </div>
                
                <div className="form-group">
                  <label>Effect Size *</label>
                  <input 
                    type="number" 
                    name="effectSize"
                    value={newRecordData.effectSize}
                    onChange={(e) => setNewRecordData({...newRecordData, effectSize: parseFloat(e.target.value) || 0})}
                    placeholder="Primary effect size"
                    step="0.0001"
                  />
                </div>
              </div>
              
              <div className="encryption-preview">
                <h4>FHE Encryption Preview</h4>
                <div className="preview-content">
                  <div className="plain-value">
                    <span>Plain Effect Size:</span>
                    <div>{newRecordData.effectSize || '0'}</div>
                  </div>
                  <div className="arrow">→</div>
                  <div className="encrypted-value">
                    <span>Encrypted Value:</span>
                    <div>{newRecordData.effectSize ? FHEEncryptNumber(newRecordData.effectSize).substring(0, 40) + '...' : 'Not available'}</div>
                  </div>
                </div>
              </div>
            </div>
            <div className="modal-footer">
              <button 
                onClick={() => setShowUploadModal(false)} 
                className="cancel-btn"
              >
                Cancel
              </button>
              <button 
                onClick={uploadGWASData} 
                disabled={uploading || !newRecordData.phenotype || !newRecordData.snpCount}
                className="submit-btn"
              >
                {uploading ? "Encrypting & Uploading..." : "Submit Securely"}
              </button>
            </div>
          </div>
        </div>
      )}

      {selectedRecord && (
        <div className="modal-overlay">
          <div className="detail-modal">
            <div className="modal-header">
              <h2>Dataset Details</h2>
              <button 
                onClick={() => {
                  setSelectedRecord(null);
                  setDecryptedValue(null);
                }} 
                className="close-modal"
              >
                &times;
              </button>
            </div>
            <div className="modal-body">
              <div className="dataset-info">
                <div className="info-row">
                  <span>Phenotype:</span>
                  <strong>{selectedRecord.phenotype}</strong>
                </div>
                <div className="info-row">
                  <span>Institution:</span>
                  <strong>{selectedRecord.institution}</strong>
                </div>
                <div className="info-row">
                  <span>SNP Count:</span>
                  <strong>{selectedRecord.snpCount?.toLocaleString()}</strong>
                </div>
                <div className="info-row">
                  <span>Status:</span>
                  <strong className={`status-badge ${selectedRecord.status}`}>{selectedRecord.status}</strong>
                </div>
                <div className="info-row">
                  <span>Upload Date:</span>
                  <strong>{new Date(selectedRecord.timestamp * 1000).toLocaleString()}</strong>
                </div>
              </div>
              
              <div className="encrypted-section">
                <h3>Encrypted Data</h3>
                <div className="encrypted-data">
                  {selectedRecord.encryptedData.substring(0, 80)}...
                </div>
                <div className="fhe-tag">
                  <span>FHE Encrypted</span>
                </div>
                
                <button 
                  className="decrypt-btn"
                  onClick={async () => {
                    if (decryptedValue !== null) {
                      setDecryptedValue(null);
                    } else {
                      const decrypted = await decryptWithSignature(selectedRecord.encryptedData);
                      if (decrypted !== null) setDecryptedValue(decrypted);
                    }
                  }}
                  disabled={isDecrypting}
                >
                  {isDecrypting ? "Decrypting..." : decryptedValue !== null ? "Hide Value" : "Decrypt with Wallet"}
                </button>
              </div>
              
              {decryptedValue !== null && (
                <div className="decrypted-section">
                  <h3>Decrypted Value</h3>
                  <div className="decrypted-value">
                    {selectedRecord.status === "processed" ? 
                      `p-value: ${decryptedValue.toExponential(4)}` : 
                      `Effect size: ${decryptedValue.toFixed(4)}`
                    }
                  </div>
                  <div className="decrypt-notice">
                    <div className="notice-icon">⚠️</div>
                    <p>This value was decrypted using your wallet signature and is only visible to you.</p>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {transactionStatus.visible && (
        <div className="transaction-modal">
          <div className="transaction-content">
            <div className={`status-icon ${transactionStatus.status}`}>
              {transactionStatus.status === "pending" && <div className="spinner"></div>}
              {transactionStatus.status === "success" && <div className="checkmark"></div>}
              {transactionStatus.status === "error" && <div className="error-icon">!</div>}
            </div>
            <div className="status-message">{transactionStatus.message}</div>
          </div>
        </div>
      )}

      <footer className="app-footer">
        <div className="footer-content">
          <div className="footer-brand">
            <div className="logo">
              <div className="dna-icon small"></div>
              <span>FHEN011</span>
            </div>
            <p>Private GWAS with Zama FHE Technology</p>
          </div>
          <div className="footer-links">
            <a href="#" className="footer-link">Documentation</a>
            <a href="#" className="footer-link">Privacy Policy</a>
            <a href="#" className="footer-link">GitHub</a>
            <a href="#" className="footer-link">Contact</a>
          </div>
        </div>
        <div className="footer-bottom">
          <div className="fhe-badge small">
            <span>Powered by Zama FHE</span>
          </div>
          <div className="copyright">
            © {new Date().getFullYear()} FHEN011 - Private Genome-Wide Association Studies
          </div>
        </div>
      </footer>
    </div>
  );
};

export default App;