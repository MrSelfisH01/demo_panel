import React, { useState, useEffect } from 'react';
import { useGetStudentActiveApiQuery } from '../../redux/features/api/student/studentActiveApi';
import { useGetStudentCurrentFeesQuery } from '../../redux/features/api/studentFeesCurrentApi/studentFeesCurrentApi';
import { useGetAcademicYearApiQuery } from '../../redux/features/api/academic-year/academicYearApi';
import { useGetFundsQuery } from '../../redux/features/api/funds/fundsApi';
import { useGetWaiversQuery } from '../../redux/features/api/waivers/waiversApi';
import { useCreateFeeMutation, useDeleteFeeMutation, useUpdateFeeMutation } from '../../redux/features/api/fees/feesApi';

const CurrentFees = () => {
  const [userId, setUserId] = useState('');
  const [selectedStudent, setSelectedStudent] = useState(null);
  const [selectedAcademicYear, setSelectedAcademicYear] = useState('');
  const [selectedFund, setSelectedFund] = useState('');
  const [selectedFees, setSelectedFees] = useState([]);
  const [paymentInputs, setPaymentInputs] = useState({});
  const [discountInputs, setDiscountInputs] = useState({});

  // API Queries
  const { data: studentData, isLoading: studentLoading, error: studentError } = useGetStudentActiveApiQuery(
    userId ? { user_id: userId } : undefined,
    { skip: !userId }
  );
  const { 
    data: feesData, 
    refetch: refetchFees 
  } = useGetStudentCurrentFeesQuery(selectedStudent?.id, { skip: !selectedStudent });
  const { data: academicYears } = useGetAcademicYearApiQuery();
  const { data: funds } = useGetFundsQuery();
  const { data: waivers } = useGetWaiversQuery();
  const [createFee] = useCreateFeeMutation();
  const [updateFee] = useUpdateFeeMutation();
  const [deleteFee] = useDeleteFeeMutation();

  console.log(feesData)

  // Handle student search
  useEffect(() => {
    if (studentData && studentData.length > 0) {
      const matchedStudent = studentData.find(
        (student) => student.user_id.toString() === userId
      );
      setSelectedStudent(matchedStudent || null);
    } else {
      setSelectedStudent(null);
    }
  }, [studentData, userId]);

  // Calculate payable amount with waiver
  const calculatePayableAmount = (fee, waivers) => {
    const feeHeadId = parseInt(fee.fee_head_id);
    const waiver = waivers?.find(
      (w) =>
        w.student_id === selectedStudent?.id &&
        w.academic_year.toString() === selectedAcademicYear &&
        Array.isArray(w.fee_types) &&
        w.fee_types.map(Number).includes(feeHeadId)
    );
    
    const waiverPercentage = waiver ? parseFloat(waiver.waiver_amount) / 100 : 0;
    const feeAmount = parseFloat(fee.amount) || 0;
    const waiverAmount = feeAmount * waiverPercentage;
    const payableAfterWaiver = feeAmount - waiverAmount;
    return { 
      waiverAmount: waiverAmount.toFixed(2), 
      payableAfterWaiver: payableAfterWaiver.toFixed(2) 
    };
  };

  // Filter out deleted fees
  const filteredFees = feesData?.fees_name_records?.filter(
    (fee) =>
      !feesData?.delete_fee_records?.some((del) =>
        del.feetype.some((df) => df.id === fee.id)
      )
  ) || [];

  // Get latest fee status and amounts - FIXED LOGIC
  const getFeeStatus = (fee) => {
    const feeRecord = feesData?.fees_records?.find((fr) => fr.feetype_id === fee.id);
    if (!feeRecord) {
      return {
        status: 'UNPAID',
        storedDiscountAmount: '0.00',
        totalPaidAmount: '0.00',
      };
    }

    // The actual paid amount should be calculated properly
    const recordAmount = parseFloat(feeRecord.amount || 0);
    const storedDiscountAmount = parseFloat(feeRecord.discount_amount || 0);
    
    return {
      status: feeRecord.status || 'UNPAID',
      storedDiscountAmount: storedDiscountAmount.toFixed(2), // Discount already applied in database
      totalPaidAmount: recordAmount.toFixed(2), // This should be the actual paid amount
    };
  };

  // Handle payment input change
  const handlePaymentInput = (feeId, value) => {
    setPaymentInputs((prev) => ({ ...prev, [feeId]: value }));
  };

  // Handle discount input change
  const handleDiscountInput = (feeId, value, payableAfterWaiver) => {
    const discount = parseFloat(value) || 0;
    if (discount > parseFloat(payableAfterWaiver)) {
      alert(`Discount cannot exceed payable amount (${payableAfterWaiver})`);
      return;
    }
    setDiscountInputs((prev) => ({ ...prev, [feeId]: value }));
  };

  // Handle fee selection
  const handleFeeSelect = (feeId) => {
    setSelectedFees((prev) =>
      prev.includes(feeId)
        ? prev.filter((id) => id !== feeId)
        : [...prev, feeId]
    );
  };

  // FIXED SUBMIT LOGIC - UPDATE EXISTING RECORDS FOR PARTIAL PAYMENTS
  const handleSubmit = async () => {
    if (!selectedAcademicYear || !selectedFund || !selectedStudent) {
      alert('Please select academic year, fund, and student');
      return;
    }

    try {
      const promises = selectedFees.map(async (feeId) => {
        const fee = filteredFees.find((f) => f.id === feeId);
        const { waiverAmount, payableAfterWaiver } = calculatePayableAmount(fee, waivers);
        const { totalPaidAmount, storedDiscountAmount } = getFeeStatus(fee);
        
        // Use current discount input OR stored discount (if no new input provided)
        const currentDiscount = discountInputs[feeId] ? 
          parseFloat(discountInputs[feeId]) : 
          parseFloat(storedDiscountAmount || 0);
          
        const currentPayment = parseFloat(paymentInputs[feeId] || 0);
        const previouslyPaid = parseFloat(totalPaidAmount || 0);
        
        // Calculate total paid amount (previously paid + current payment)
        const totalPaidAfterThisTransaction = previouslyPaid + currentPayment;
        
        // Calculate total payable after waiver and discount
        const totalPayableAfterWaiverAndDiscount = parseFloat(payableAfterWaiver) - currentDiscount;
        
        // Determine status
        let status = 'UNPAID';
        if (totalPaidAfterThisTransaction >= totalPayableAfterWaiverAndDiscount) {
          status = 'PAID';
        } else if (totalPaidAfterThisTransaction > 0) {
          status = 'PARTIAL';
        }

        const feeData = {
          amount: totalPaidAfterThisTransaction.toFixed(2), // Total paid amount
          discount_amount: currentDiscount.toFixed(2),
          waiver_amount: waiverAmount,
          status: status,
          is_enable: true,
          description: '',
          payment_method: 'ONLINE',
          payment_status: '',
          online_transaction_id: '',
          fees_record: '',
          student_id: selectedStudent.id,
          feetype_id: feeId,
          fund_id: parseInt(selectedFund),
          academic_year: parseInt(selectedAcademicYear),
        };

        // Check if there's already a fee record for this fee type
        const existingFeeRecord = feesData?.fees_records?.find(
          (record) => record.feetype_id === feeId
        );

        if (existingFeeRecord) {
          // Update existing record
          return updateFee({ id: existingFeeRecord.id, ...feeData }).unwrap();
        } else {
          // Create new record
          return createFee(feeData).unwrap();
        }
      });

      await Promise.all(promises);
      alert('Fees processed successfully');
      setSelectedFees([]);
      setPaymentInputs({});
      setDiscountInputs({});
      refetchFees();
    } catch (error) {
      alert('Error processing fees');
      console.error(error);
    }
  };

  // Handle fee update
  const handleUpdateFee = async (feeId, updatedData) => {
    try {
      await updateFee({ id: feeId, ...updatedData }).unwrap();
      alert('Fee updated successfully');
      refetchFees();
    } catch (error) {
      alert('Error updating fee');
      console.error(error);
    }
  };

  // Handle fee deletion
  const handleDeleteFee = async (feeId) => {
    try {
      await deleteFee(feeId).unwrap();
      alert('Fee deleted successfully');
      refetchFees();
    } catch (error) {
      alert('Error deleting fee');
      console.error(error);
    }
  };

  return (
    <div className="p-6 max-w-7xl mx-auto">
      <h1 className="text-2xl font-bold mb-4">Current Fees</h1>

      {/* Student Search */}
      <div className="mb-4">
        <input
          type="text"
          placeholder="Enter User ID"
          value={userId}
          onChange={(e) => setUserId(e.target.value)}
          className="border p-2 rounded w-full"
        />
        {studentLoading && <p>Loading student...</p>}
        {studentError && <p className="text-red-500">Error fetching student data</p>}
      </div>

      {/* Student Information */}
      {selectedStudent && (
        <div className="mb-4 p-4 border rounded">
          <h2 className="text-xl font-semibold">Student Information</h2>
          <p><strong>Name:</strong> {selectedStudent.name}</p>
          <p><strong>Father's Name:</strong> {selectedStudent.father_name || 'N/A'}</p>
          <p><strong>Mother's Name:</strong> {selectedStudent.mother_name || 'N/A'}</p>
          <p><strong>Roll No:</strong> {selectedStudent.roll_no || 'N/A'}</p>
        </div>
      )}
      {!selectedStudent && userId && !studentLoading && (
        <p className="text-red-500">No student found with User ID: {userId}</p>
      )}

      {/* Academic Year and Fund Selection */}
      <div className="flex gap-4 mb-4">
        <select
          value={selectedAcademicYear}
          onChange={(e) => setSelectedAcademicYear(e.target.value)}
          className="border p-2 rounded"
        >
          <option value="">Select Academic Year</option>
          {academicYears?.map((year) => (
            <option key={year.id} value={year.id}>
              {year.name}
            </option>
          ))}
        </select>
        <select
          value={selectedFund}
          onChange={(e) => setSelectedFund(e.target.value)}
          className="border p-2 rounded"
        >
          <option value="">Select Fund</option>
          {funds?.map((fund) => (
            <option key={fund.id} value={fund.id}>
              {fund.name}
            </option>
          ))}
        </select>
      </div>

      {/* Current Fees Table - FIXED CALCULATIONS WITH EXISTING RECORD HANDLING */}
      {filteredFees.length > 0 && (
        <div className="mb-8">
          <h2 className="text-xl font-semibold mb-2">Current Fees</h2>
          <table className="w-full border-collapse border">
            <thead>
              <tr className="bg-gray-200">
                <th className="border p-2">Fees Title</th>
                <th className="border p-2">Amount</th>
                <th className="border p-2">Waiver Amount</th>
                <th className="border p-2">Discount Input</th>
                <th className="border p-2">Payable Amount</th>
                <th className="border p-2">Already Paid</th>
                <th className="border p-2">Paid Now</th>
                <th className="border p-2">Due Amount</th>
                <th className="border p-2">Status</th>
                <th className="border p-2">Select</th>
              </tr>
            </thead>
            <tbody>
              {filteredFees.map((fee) => {
                const { waiverAmount, payableAfterWaiver } = calculatePayableAmount(fee, waivers);
                const { status, storedDiscountAmount, totalPaidAmount } = getFeeStatus(fee);
                
                // Use current input OR stored discount from database
                const effectiveDiscount = discountInputs[fee.id] ? 
                  parseFloat(discountInputs[fee.id]) : 
                  parseFloat(storedDiscountAmount || 0);
                  
                const currentPayment = parseFloat(paymentInputs[fee.id] || 0);
                const alreadyPaid = parseFloat(totalPaidAmount || 0);
                
                // Calculate final payable amount after waiver and effective discount
                const finalPayableAmount = parseFloat(payableAfterWaiver) - effectiveDiscount;
                
                // FIXED: Calculate due amount properly
                // Due = Total Payable (after waiver & discount) - Already Paid - Current Payment
                const dueAmount = Math.max(0, finalPayableAmount - alreadyPaid - currentPayment).toFixed(2);
                
                // Check if there's an existing fee record
                const existingRecord = feesData?.fees_records?.find(
                  (record) => record.feetype_id === fee.id
                );
                
                // Determine row styling based on status
                const rowClass = status === 'PAID' 
                  ? 'bg-green-50' 
                  : status === 'PARTIAL' 
                    ? 'bg-yellow-50' 
                    : '';

                return (
                  <tr key={fee.id} className={rowClass}>
                    <td className="border p-2">
                      {fee.fees_title}
                      {existingRecord && (
                        <span className="ml-2 text-xs bg-blue-100 text-blue-800 px-2 py-1 rounded">
                          {status === 'PARTIAL' ? 'UPDATE' : 'EXISTING'}
                        </span>
                      )}
                    </td>
                    <td className="border p-2">{fee.amount}</td>
                    <td className="border p-2">{waiverAmount}</td>
                    <td className="border p-2">
                      <input
                        type="number"
                        value={discountInputs[fee.id] || ''}
                        onChange={(e) => handleDiscountInput(fee.id, e.target.value, payableAfterWaiver)}
                        className="border p-1 rounded w-full"
                        min="0"
                        disabled={status === 'PAID'}
                        placeholder={existingRecord ? `Current: ${storedDiscountAmount}` : '0'}
                      />
                    </td>
                    <td className="border p-2">{finalPayableAmount.toFixed(2)}</td>
                    <td className="border p-2 font-semibold">{alreadyPaid.toFixed(2)}</td>
                    <td className="border p-2">
                      <input
                        type="number"
                        value={paymentInputs[fee.id] || ''}
                        onChange={(e) => handlePaymentInput(fee.id, e.target.value)}
                        className="border p-1 rounded w-full"
                        min="0"
                        disabled={status === 'PAID'}
                        placeholder={status === 'PARTIAL' ? `Remaining: ${dueAmount}` : '0'}
                      />
                    </td>
                    <td className="border p-2 font-semibold text-red-600">{dueAmount}</td>
                    <td className="border p-2">
                      <span className={`px-2 py-1 rounded text-xs font-semibold ${
                        status === 'PAID' 
                          ? 'bg-green-100 text-green-800' 
                          : status === 'PARTIAL' 
                            ? 'bg-yellow-100 text-yellow-800' 
                            : 'bg-red-100 text-red-800'
                      }`}>
                        {status}
                      </span>
                    </td>
                    <td className="border p-2">
                      <input
                        type="checkbox"
                        checked={selectedFees.includes(fee.id)}
                        onChange={() => handleFeeSelect(fee.id)}
                        disabled={status === 'PAID'}
                      />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          <button
            onClick={handleSubmit}
            className="mt-4 bg-blue-500 text-white p-2 rounded hover:bg-blue-600"
            disabled={selectedFees.length === 0}
          >
            {selectedFees.some(feeId => {
              const existingRecord = feesData?.fees_records?.find(
                (record) => record.feetype_id === feeId
              );
              return existingRecord;
            }) ? 'Update Selected Fees' : 'Submit Selected Fees'}
          </button>
        </div>
      )}
      {filteredFees.length === 0 && selectedStudent && (
        <p className="text-gray-500 mb-8">No current fees available for this student.</p>
      )}

      {/* Fee History Table - FIXED TO SHOW ACTUAL PAID AMOUNTS */}
      {feesData?.fees_records?.length > 0 && (
        <div>
          <h2 className="text-xl font-semibold mb-2">Fee History</h2>
          <table className="w-full border-collapse border">
            <thead>
              <tr className="bg-gray-200">
                <th className="border p-2">Fee Type</th>
                <th className="border p-2">Total Paid Amount</th>
                <th className="border p-2">Waiver Amount</th>
                <th className="border p-2">Discount Amount</th>
                <th className="border p-2">Status</th>
                <th className="border p-2">Actions</th>
              </tr>
            </thead>
            <tbody>
              {feesData.fees_records.map((fee) => {
                // Find the corresponding fee in fees_name_records to calculate waiver_amount
                const feeNameRecord = feesData.fees_name_records?.find(
                  (f) => f.id === fee.feetype_id
                );
                // Calculate waiver_amount if feeNameRecord exists, else default to '0.00'
                const waiverAmount = feeNameRecord
                  ? calculatePayableAmount(feeNameRecord, waivers).waiverAmount
                  : '0.00';

                return (
                  <tr key={fee.id}>
                    <td className="border p-2">{fee.feetype_name}</td>
                    <td className="border p-2">{fee.amount}</td> {/* This now shows actual paid amount */}
                    <td className="border p-2">{fee.waiver_amount || waiverAmount}</td>
                    <td className="border p-2">{fee.discount_amount}</td>
                    <td className="border p-2">{fee.status}</td>
                    <td className="border p-2">
                      <button
                        onClick={() =>
                          handleUpdateFee(fee.id, {
                            amount: fee.amount,
                            discount_amount: fee.discount_amount,
                            status: fee.status,
                            waiver_amount: fee.waiver_amount || waiverAmount,
                          })
                        }
                        className="bg-yellow-500 text-white p-1 rounded mr-2 hover:bg-yellow-600"
                      >
                        Update
                      </button>
                      <button
                        onClick={() => handleDeleteFee(fee.id)}
                        className="bg-red-500 text-white p-1 rounded hover:bg-red-600"
                      >
                        Delete
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      {feesData?.fees_records?.length === 0 && selectedStudent && (
        <p className="text-gray-500">No fee history available for this student.</p>
      )}
    </div>
  );
};

export default CurrentFees;